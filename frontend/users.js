requireAuth();
document.getElementById('nav').innerHTML = navHtml('users');
wireLogout();
const usersList=document.getElementById('users-list');
const msg=document.getElementById('msg');

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

document.getElementById('create-user-form').onsubmit=async(e)=>{
  e.preventDefault();
  const payload=Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    e.target.reset(); msg.textContent='User created'; await loadUsers();
  } catch(err){ msg.textContent=err.message; }
};

loadUsers().catch(err=>usersList.textContent=err.message);
