/* GitHub 저장소에 직접 커밋한다.

   발사탕은 정적 사이트라 서버가 없다. 그래서 어드민이 파일을 고치고
   GitHub Contents API 로 커밋을 올린다. 커밋이 올라가면 CI 가 게이트를 돌리고,
   통과하면 Pages 가 배포한다. 서버를 사지 않고도 사람이 혼자 발행할 수 있다.

   ── 토큰에 대해 ──
   fine-grained personal access token 이 필요하다.
     Repository access : butblank-oss/balsatang 하나만 (어드민 저장소는 필요 없다)
     Permissions       : Contents = Read and write
     Expiration        : 되도록 짧게 (90일)

   토큰은 이 브라우저의 localStorage 에만 둔다. 저장소에 절대 넣지 않는다.
   어드민 페이지는 공개 도메인에 있으므로, 이 페이지에 XSS 가 생기면
   토큰이 새어나갈 수 있다. 그래서 권한을 저장소 하나·Contents 로만 좁히고
   만료를 짧게 두는 것이 전제다. 조직 계정 토큰이나 classic 토큰은 쓰지 않는다.
*/
const GH = {
  /* 커밋 대상은 앱 저장소다. 어드민은 admin.balsatang.com 에 따로 얹혀 있지만
     고치는 파일(data.js, data/staging/…)은 전부 저쪽에 있다. */
  owner: 'butblank-oss',
  repo: 'balsatang',
  branch: 'main',
  KEY: 'balsatang.gh.token',

  get token() { return localStorage.getItem(this.KEY) || ''; },
  set token(v) { v ? localStorage.setItem(this.KEY, v) : localStorage.removeItem(this.KEY); },

  async api(path, opt = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opt,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(opt.body ? { 'Content-Type': 'application/json' } : {}),
        ...opt.headers
      }
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { }
    if (!res.ok) {
      const msg = json?.message || `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? '토큰이 유효하지 않습니다'
        : res.status === 403 ? `권한이 없습니다 — ${msg}`
          : res.status === 409 ? '다른 곳에서 먼저 바뀌었습니다. 새로고침하고 다시 시도하세요'
            : msg);
    }
    return json;
  },

  /* 토큰이 이 저장소에 쓸 수 있는지 확인한다 */
  async check() {
    const r = await this.api(`/repos/${this.owner}/${this.repo}`);
    return { name: r.full_name, canWrite: !!r.permissions?.push };
  },

  /* UTF-8 문자열 ↔ base64. 한글이 섞여 있어 그냥 btoa 를 쓰면 깨진다. */
  enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },
  dec(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  },

  /* 경로는 구분자 '/' 를 살린 채 세그먼트별로만 인코딩한다.
     통째로 encodeURIComponent 하면 '/' 가 %2F 가 돼서 경로가 깨진다. */
  path(p) { return p.split('/').map(encodeURIComponent).join('/'); },

  async getFile(path) {
    const r = await this.api(
      `/repos/${this.owner}/${this.repo}/contents/${this.path(path)}?ref=${this.branch}`);
    return { text: this.dec(r.content), sha: r.sha };
  },

  /* sha 를 같이 보내야 한다. 그 사이 다른 곳에서 바뀌었으면 409 로 막힌다 —
     모르고 덮어쓰는 것보다 낫다. */
  async putFile(path, text, sha, message) {
    return this.api(`/repos/${this.owner}/${this.repo}/contents/${this.path(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: this.enc(text), sha, branch: this.branch })
    });
  }
};

/* 여러 파일을 한 커밋으로 올린다.

   발행은 파일 여러 개를 동시에 건드린다 — data.js, 스테이징 배치, 반려 기록,
   심사 목록. 하나씩 PUT 하면 커밋이 네 개로 쪼개지고, 중간에 실패하면 반쪽만
   반영된 상태가 남는다. 그래서 Git Data API 로 트리를 통째로 만들어 한 번에 올린다.

   files: [{ path, text }] — text 가 null 이면 그 파일을 지운다.
   base 는 우리가 읽은 시점의 커밋 sha. 그 사이 저장소가 바뀌었으면 밀리지 않고 막힌다. */
Object.assign(GH, {
  async headSha() {
    const r = await this.api(`/repos/${this.owner}/${this.repo}/git/ref/heads/${this.branch}`);
    return r.object.sha;
  },

  async commitFiles(files, message, baseSha) {
    const base = baseSha || await this.headSha();
    const baseCommit = await this.api(`/repos/${this.owner}/${this.repo}/git/commits/${base}`);

    /* 지울 파일은 sha:null 로, 남길 파일은 blob 을 만들어 붙인다.
       base64 로 올려야 한글이 깨지지 않는다. */
    const tree = [];
    for (const f of files) {
      if (f.text == null) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
      const blob = await this.api(`/repos/${this.owner}/${this.repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: this.enc(f.text), encoding: 'base64' })
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await this.api(`/repos/${this.owner}/${this.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree })
    });
    const commit = await this.api(`/repos/${this.owner}/${this.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [base] })
    });
    /* force 를 주지 않는다. 그 사이 누가 올렸으면 여기서 막히는 게 맞다. */
    await this.api(`/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
    return commit;
  },

  /* 없는 파일은 null 을 준다. 반려 기록처럼 '있으면 이어 쓰고 없으면 새로' 가 필요하다. */
  async getFileOrNull(path) {
    try { return await this.getFile(path); }
    catch (e) { if (/찾을 수 없|Not Found|404/i.test(e.message)) return null; throw e; }
  }
});
