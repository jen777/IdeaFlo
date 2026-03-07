requireAuth();
document.getElementById('nav').innerHTML = navHtml('create');
wireLogout();

document.getElementById('create-idea-form').onsubmit = async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  await api('/ideas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  document.getElementById('msg').textContent = 'Idea created';
  e.target.reset();
};
