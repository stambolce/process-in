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
  if (!response.ok) throw new Error(method+' '+path+' returned HTTP '+response.status);
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
  const branch = repo.default_branch;
  const head = await api('repos/'+full+'/git/ref/heads/'+encodeURIComponent(branch));
  const commit = await api('repos/'+full+'/git/commits/'+head.object.sha);
  const tree = await api('repos/'+full+'/git/trees/'+commit.tree.sha+'?recursive=1');
  const allowed = ['README.md','README.mk.md','assets/product-hero.svg'];
  if (tree.truncated) throw new Error('Incomplete tree');
  if (tree.tree.some(e => e.type === 'blob' && !allowed.includes(e.path))) throw new Error('Refusing to modify repository with unexpected files: '+full);
  const entries = [];
  for (const path of allowed) {
    const content = await fs.readFile('portfolio-release/products/'+p.slug+'/'+path,'utf8');
    entries.push({path,mode:'100644',type:'blob',content});
  }
  const nextTree = await api('repos/'+full+'/git/trees','POST',{base_tree:commit.tree.sha,tree:entries});
  let published = head.object.sha;
  if (nextTree.sha !== commit.tree.sha) {
    const next = await api('repos/'+full+'/git/commits','POST',{message:'Publish bilingual '+p.name+' product showcase',tree:nextTree.sha,parents:[head.object.sha]});
    await api('repos/'+full+'/git/refs/heads/'+encodeURIComponent(branch),'PATCH',{sha:next.sha,force:false});
    published = next.sha;
  }
  await api('repos/'+full,'PATCH',{description:p.description,homepage:p.website});
  await api('repos/'+full+'/topics','PUT',{names:p.topics});
  for (const path of allowed) await api('repos/'+full+'/contents/'+path+'?ref='+encodeURIComponent(published));
  const verified = await api('repos/'+full);
  if (verified.private || verified.homepage !== p.website) throw new Error('Publication verification failed');
  results.push({repo:verified.html_url,commit:verified.html_url+'/commit/'+published});
  console.log('Published '+verified.html_url+'/commit/'+published);
}
await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, '# Published showcases\n\n'+results.map(r=>'- ['+r.repo+']('+r.repo+') · [commit]('+r.commit+')').join('\n')+'\n');
