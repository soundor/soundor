// A GitHub Releases API in memory, with public downloads, for the release
// scripts' tests (engine-prebuilts.test.mjs, vst3-adapters.test.mjs).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import { github } from './engine-prebuilts.mjs';

export async function fakeGitHub() {
  const releases = [];
  let next = 1;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, base);
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(value === undefined ? '' : JSON.stringify(value));
    };
    const find = (id) => releases.find((r) => r.id === Number(id));
    let match;
    if (request.method === 'GET' && url.pathname === '/repos/o/r/releases')
      return reply(
        200,
        releases
          .slice((Number(url.searchParams.get('page')) - 1) * 100)
          .slice(0, 100),
      );
    if (request.method === 'POST' && url.pathname === '/repos/o/r/releases') {
      const value = JSON.parse(body);
      if (releases.some((r) => r.tag_name === value.tag_name))
        return reply(422, { message: 'tag exists' });
      const id = next++;
      const created = {
        ...value,
        id,
        assets: [],
        upload_url: `${base}/upload/${id}/assets{?name,label}`,
        html_url: `${base}/r/${id}`,
      };
      releases.push(created);
      return reply(201, created);
    }
    if ((match = /^\/upload\/(\d+)\/assets$/.exec(url.pathname))) {
      const target = find(match[1]);
      if (!target.draft) return reply(422, { message: 'immutable' });
      const id = next++;
      const name = url.searchParams.get('name');
      target.assets.push({
        id,
        name,
        contents: body,
        digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
        browser_download_url: `${base}/download/${id}`,
      });
      return reply(201, { id });
    }
    if (
      (match = /^\/download\/(\d+)$/.exec(url.pathname)) ||
      (match = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(url.pathname))
    ) {
      const asset = releases
        .flatMap((r) => r.assets)
        .find((a) => a.id === Number(match[1]));
      if (request.method === 'DELETE') {
        const owner = releases.find((r) => r.assets.includes(asset));
        if (!owner.draft) return reply(422, { message: 'immutable' });
        owner.assets = owner.assets.filter((a) => a !== asset);
        return reply(204);
      }
      response.writeHead(200);
      return response.end(asset.contents);
    }
    if ((match = /^\/repos\/o\/r\/releases\/tags\/(.+)$/.exec(url.pathname))) {
      const found = releases.find(
        (r) => r.tag_name === decodeURIComponent(match[1]) && !r.draft,
      );
      return found
        ? reply(200, view(found))
        : reply(404, { message: 'Not Found' });
    }
    if ((match = /^\/repos\/o\/r\/releases\/(\d+)$/.exec(url.pathname))) {
      const found = find(match[1]);
      if (request.method === 'DELETE') {
        releases.splice(releases.indexOf(found), 1);
        return reply(204);
      }
      if (request.method === 'PATCH') {
        Object.assign(found, JSON.parse(body));
        return reply(200, view(found));
      }
      return reply(200, view(found));
    }
    reply(404, { message: `${request.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const view = (r) => ({
    ...r,
    assets: r.assets.map(({ contents: _contents, ...asset }) => asset),
  });
  return {
    releases,
    client: github({ repository: 'o/r', token: 't', api: base }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
