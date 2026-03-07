requireAuth();
document.getElementById('nav').innerHTML = navHtml('ideas');
wireLogout();

let selectedIdeaId = null;
const ideasList = document.getElementById('ideas-list');
const docsList = document.getElementById('docs-list');
const detailPanel = document.getElementById('detail-panel');

async function loadIdeas(){
  const ideas = await api('/ideas');
  ideasList.innerHTML = '';
  if (!ideas.length) return (ideasList.textContent='No ideas yet.');
  ideas.forEach(idea=>{
    const div=document.createElement('div');
    div.className='idea-item';
    div.innerHTML=`<strong>${idea.title}</strong><div>${idea.summary||''}</div><div class='small'>Status: ${idea.status}</div><button>Open</button>`;
    div.querySelector('button').onclick=()=>selectIdea(idea.id);
    ideasList.appendChild(div);
  });
}

async function selectIdea(id){
  const idea = await api(`/ideas/${id}`);
  selectedIdeaId=id; detailPanel.hidden=false;
  const f=document.getElementById('update-idea-form');
  f.id.value=idea.id; f.title.value=idea.title; f.summary.value=idea.summary; f.status.value=idea.status;
  f.current_state.value=idea.current_state; f.future_steps.value=idea.future_steps;
  await loadDocuments();
}

async function downloadDocument(docId, filename){
  const res = await fetch(`${API_BASE}/ideas/${selectedIdeaId}/documents/${docId}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Download failed');
  const blob=await res.blob();
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

async function loadDocuments(){
  const docs = await api(`/ideas/${selectedIdeaId}/documents`);
  docsList.innerHTML='';
  if(!docs.length) return (docsList.textContent='No documents uploaded.');
  docs.forEach(doc=>{
    const div=document.createElement('div'); div.className='doc-item';
    div.innerHTML=`<strong>${doc.filename}</strong><div class='small'>${doc.size_bytes} bytes</div><div class='row'><button class='download'>Download</button><button class='danger delete'>Delete</button></div>`;
    div.querySelector('.download').onclick=()=>downloadDocument(doc.id,doc.filename);
    div.querySelector('.delete').onclick=async()=>{ if(confirm('Delete?')){ await api(`/ideas/${selectedIdeaId}/documents/${doc.id}`,{method:'DELETE'}); await loadDocuments(); }};
    docsList.appendChild(div);
  });
}

document.getElementById('update-idea-form').onsubmit=async(e)=>{
  e.preventDefault(); if(!selectedIdeaId) return;
  const payload=Object.fromEntries(new FormData(e.target).entries()); delete payload.id;
  await api(`/ideas/${selectedIdeaId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  await loadIdeas(); alert('Saved');
};

document.getElementById('delete-idea-btn').onclick=async()=>{
  if(!selectedIdeaId||!confirm('Delete idea and docs?')) return;
  await api(`/ideas/${selectedIdeaId}`,{method:'DELETE'});
  selectedIdeaId=null; detailPanel.hidden=true; docsList.innerHTML='';
  await loadIdeas();
};

document.getElementById('upload-form').onsubmit=async(e)=>{
  e.preventDefault(); if(!selectedIdeaId) return;
  const fi=e.target.querySelector('input[type="file"]'); if(!fi.files[0]) return;
  const fd=new FormData(); fd.append('uploaded_file', fi.files[0]);
  await api(`/ideas/${selectedIdeaId}/documents`,{method:'POST',body:fd});
  fi.value=''; await loadDocuments();
};

loadIdeas().catch(err=>ideasList.textContent=err.message);
