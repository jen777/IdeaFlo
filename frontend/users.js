requireAuth();
document.getElementById('nav').innerHTML = navHtml('users');
wireLogout();
const usersList=document.getElementById('users-list');
const msg=document.getElementById('msg');
const tokensList=document.getElementById('tokens-list');
const newTokenDiv=document.getElementById('new-token');

async function loadUsers(){
  const users=await api('/users');
  usersList.innerHTML='';
  users.forEach(u=>{
    const d=document.createElement('div'); d.className='idea-item';
    d.innerHTML=`<strong>${u.username}</strong><div class='small'>id=${u.id}</div><button class='danger'>Delete</button>`;
    d.querySelector('button').onclick=async()=>{ if(confirm(`Delete ${u.username}?`)){ await api(`/users/${u.id}`,{method:'DELETE'}); await loadUsers(); }};
    usersList.appendChild(d);
  });
}

async function loadTokens(){
  const tokens = await api('/api-tokens');
  tokensList.innerHTML='';
  if (!tokens.length) return (tokensList.textContent='No API tokens yet.');
  tokens.forEach(t=>{
    const d=document.createElement('div'); d.className='idea-item';
    const revoked=t.revoked_at ? `revoked at ${new Date(t.revoked_at).toLocaleString()}` : 'active';
    const exp=t.expires_at ? `expires ${new Date(t.expires_at).toLocaleString()}` : 'no expiry';
    d.innerHTML=`<strong>${t.name}</strong><div class='small'>prefix: ${t.token_prefix}... | scope: ${t.scope} | ${exp} | ${revoked}</div><button class='danger'>Revoke</button>`;
    d.querySelector('button').onclick=async()=>{ if(confirm(`Revoke token ${t.name}?`)){ await api(`/api-tokens/${t.id}`,{method:'DELETE'}); await loadTokens(); }};
    tokensList.appendChild(d);
  });
}

document.getElementById('create-user-form').onsubmit=async(e)=>{
  e.preventDefault();
  const payload=Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    e.target.reset(); msg.textContent='User created'; await loadUsers();
  } catch(err){ msg.textContent=err.message; }
};

document.getElementById('create-token-form').onsubmit=async(e)=>{
  e.preventDefault();
  const payload=Object.fromEntries(new FormData(e.target).entries());
  if (!payload.expires_at) delete payload.expires_at; else payload.expires_at = new Date(payload.expires_at).toISOString();
  try {
    const created = await api('/api-tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    e.target.reset();
    newTokenDiv.innerHTML = `Token created. Copy now (shown once): <code>${created.token}</code>`;
    await loadTokens();
  } catch(err){ newTokenDiv.textContent = err.message; }
};

loadUsers().catch(err=>usersList.textContent=err.message);
loadTokens().catch(err=>tokensList.textContent=err.message);
