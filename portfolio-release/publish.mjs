import fs from 'node:fs/promises';
const owner = 'stambolce';
const manifest = JSON.parse(await fs.readFile('portfolio-release/manifest.json','utf8'));
const token = process.env.GH_TOKEN;
if (!token) throw new Error('Missing configured portfolio credential');
async function api(path, method='GET', body) {
  const response = await fetch('https://api.github.com/'+path, {
    method, headers: {Authorization:'Bearer '+token, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) { const detail = await response.json().catch(()=>({})); throw new Error(method+' '+path+' returned HTTP '+response.status+'; '+(detail.message || 'No explanation')+'; retry-after='+(response.headers.get('retry-after') || 'none')); }
  return response.status === 204 ? null : response.json();
}
const results = [];
for (const p of manifest.products) {
  if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error('Invalid repository name');
  const full = owner+'/'+p.slug;
  let repo;
  try { repo = await api('repos/'+full); } catch(e) {
    if (!e.message.endsWith('HTTP 404')) throw e;
    repo = await api('user/repos','POST',{name:p.slug,description:p.description,homepage:p.website,private:false,auto_init:true});
  }
  if (repo.private || repo.owner.login !== owner) throw new Error('Unexpected repository ownership or visibility');
  await api('repos/'+full,'PATCH',{description:p.description,homepage:p.website});
  await api('repos/'+full+'/topics','PUT',{names:p.topics});
  const verified = await api('repos/'+full);
  if (verified.private || verified.homepage !== p.website) throw new Error('Publication verification failed');
  results.push({repo:verified.html_url});
  console.log('Created/verified '+verified.html_url);
}
await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, '# Created repositories\n\n'+results.map(r=>'- ['+r.repo+']('+r.repo+')').join('\n')+'\n');
