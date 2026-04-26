import { useState, useEffect, useCallback } from "react";

// ─── Palette ──────────────────────────────────────────────────────────────────
const G = {
  bg: "#F7F6F2", surface: "#FFFFFF", surfaceAlt: "#F0EDE6", border: "#DDD9D0",
  accent: "#1A5C4A", accentLight: "#E8F2EE", accentMid: "#2E7D5E",
  danger: "#C0392B", dangerLight: "#FDECEA",
  text: "#1C1C1C", textMid: "#555550", textLight: "#8A8880", gold: "#B8860B",
};

const injectStyles = () => {
  if (document.getElementById("exp-styles")) return;
  const s = document.createElement("style");
  s.id = "exp-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; font-family: 'DM Sans', sans-serif; background: ${G.bg}; color: ${G.text}; }
    ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${G.border}; border-radius: 10px; }
    .fade-in { animation: fadeIn 0.35s ease forwards; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    input, textarea, select { font-family:'DM Sans',sans-serif; font-size:14px; color:${G.text}; background:${G.surface}; border:1.5px solid ${G.border}; border-radius:8px; padding:9px 12px; width:100%; outline:none; transition:border-color .2s,box-shadow .2s; }
    input:focus, textarea:focus, select:focus { border-color:${G.accent}; box-shadow:0 0 0 3px ${G.accentLight}; }
    textarea { resize:vertical; min-height:80px; line-height:1.5; }
    button { font-family:'DM Sans',sans-serif; cursor:pointer; border:none; transition:all .2s; }
    label { font-size:12px; font-weight:500; color:${G.textMid}; letter-spacing:.04em; text-transform:uppercase; display:block; margin-bottom:5px; }
    .tab-active { background:${G.accent} !important; color:#fff !important; }
    .tag { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:500; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `;
  document.head.appendChild(s);
};

// ─── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = "expedientes_clinicos_v1";
const DRIVE_FOLDER_ID = "1iolMZ3VjQoUvhaX7TYTgFMa8io-_bq6r";

async function loadAll() {
  try { const r = await window.storage.get(STORAGE_KEY); return r ? JSON.parse(r.value) : { patients:[], consultations:[], prescriptions:[], studies:[] }; }
  catch { return { patients:[], consultations:[], prescriptions:[], studies:[] }; }
}
async function saveAll(data) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(data)); } catch(e) { console.error(e); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const calcAge = (dob) => { if(!dob) return "—"; const d=new Date(dob),n=new Date(); let a=n.getFullYear()-d.getFullYear(); if(n<new Date(n.getFullYear(),d.getMonth(),d.getDate())) a--; return a+" años"; };

function toBase64(file) {
  return new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
}

// ─── Google Drive Upload via Claude API ───────────────────────────────────────
async function uploadToDrive(file, patientName, patientId) {
  const base64 = await toBase64(file);
  const prompt = `Sube este archivo a Google Drive usando el MCP de Drive.
- Carpeta padre ID: ${DRIVE_FOLDER_ID}
- Primero busca si existe una subcarpeta con el nombre exacto "${patientName}" dentro de esa carpeta padre (parentId = '${DRIVE_FOLDER_ID}').
- Si NO existe, créala con mimeType application/vnd.google-apps.folder y parentId ${DRIVE_FOLDER_ID}.
- Luego sube el archivo dentro de esa subcarpeta con:
  - title: "${file.name}"
  - mimeType: "${file.type || 'application/octet-stream'}"
  - content en base64 (ya incluido abajo)
  - parentId: el ID de la subcarpeta del paciente

Responde SOLO con JSON sin markdown:
{"success": true, "fileId": "...", "fileName": "...", "viewUrl": "...", "folderId": "..."}

Base64 del archivo:
${base64}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      mcp_servers: [{ type:"url", url:"https://drivemcp.googleapis.com/mcp/v1", name:"drive-mcp" }],
      messages: [{ role:"user", content: prompt }]
    })
  });
  const data = await resp.json();
  const text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
  const clean = text.replace(/```json|```/g,"").trim();
  return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}")+1));
}

// ─── Components ───────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant="primary", size="md", style={}, disabled }) {
  const base = { display:"inline-flex",alignItems:"center",gap:6,fontWeight:500,borderRadius:8,border:"none",cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,transition:"all .2s",...style };
  const sizes = { sm:{padding:"6px 12px",fontSize:12}, md:{padding:"9px 18px",fontSize:13}, lg:{padding:"11px 24px",fontSize:14} };
  const variants = {
    primary:{background:G.accent,color:"#fff",boxShadow:"0 2px 8px rgba(26,92,74,0.25)"},
    secondary:{background:G.surfaceAlt,color:G.text,border:`1.5px solid ${G.border}`},
    danger:{background:G.danger,color:"#fff"},
    ghost:{background:"transparent",color:G.accent,border:`1.5px solid ${G.accentLight}`},
  };
  return <button onClick={disabled?undefined:onClick} style={{...base,...sizes[size],...variants[variant]}}>{children}</button>;
}
function Card({ children, style={} }) { return <div style={{background:G.surface,border:`1px solid ${G.border}`,borderRadius:12,padding:20,...style}}>{children}</div>; }
function Field({ label, children }) { return <div style={{marginBottom:14}}><label>{label}</label>{children}</div>; }
function EmptyState({ icon, text }) { return <div style={{textAlign:"center",padding:"40px 20px",color:G.textLight}}><div style={{fontSize:36,marginBottom:10}}>{icon}</div><div style={{fontSize:13}}>{text}</div></div>; }

// ─── File Upload Module ───────────────────────────────────────────────────────
function FilesTab({ patient, data, persist }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null); // {url, name, type}

  const files = (data.files || []).filter(f => f.patientId === patient.id).sort((a,b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const handleFiles = async (fileList) => {
    const allowed = ["image/jpeg","image/png","image/jpg","application/pdf"];
    const valid = Array.from(fileList).filter(f => allowed.includes(f.type));
    if (!valid.length) { alert("Solo se permiten imágenes (JPG, PNG) y PDFs."); return; }
    setUploading(true);
    for (const file of valid) {
      setProgress(`Subiendo ${file.name}...`);
      try {
        const result = await uploadToDrive(file, `${patient.firstName} ${patient.lastName}`, patient.id);
        if (result.success) {
          const entry = {
            id: uid(),
            patientId: patient.id,
            fileId: result.fileId,
            folderId: result.folderId,
            fileName: result.fileName || file.name,
            viewUrl: result.viewUrl,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            label: "",
          };
          const newData = { ...data, files: [...(data.files||[]), entry] };
          await persist(newData);
        }
      } catch(e) { alert(`Error subiendo ${file.name}`); }
    }
    setProgress(""); setUploading(false);
  };

  const deleteFile = async (fileId) => {
    if (!confirm("¿Eliminar este archivo del expediente? Se eliminará también de Drive.")) return;
    const newFiles = (data.files||[]).filter(f => f.id !== fileId);
    await persist({ ...data, files: newFiles });
  };

  const updateLabel = async (fileId, label) => {
    const newFiles = (data.files||[]).map(f => f.id===fileId ? {...f,label} : f);
    await persist({ ...data, files: newFiles });
  };

  const isImage = (mime) => mime && mime.startsWith("image/");
  const formatSize = (bytes) => bytes < 1024*1024 ? `${(bytes/1024).toFixed(0)} KB` : `${(bytes/(1024*1024)).toFixed(1)} MB`;

  return (
    <div className="fade-in">
      {/* Preview modal */}
      {preview && (
        <div onClick={()=>setPreview(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:G.surface,borderRadius:16,padding:20,maxWidth:"90vw",maxHeight:"90vh",overflow:"auto",position:"relative"}}>
            <button onClick={()=>setPreview(null)} style={{position:"absolute",top:12,right:12,background:G.surfaceAlt,border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:14}}>✕ Cerrar</button>
            <div style={{fontWeight:500,marginBottom:12,paddingRight:60}}>{preview.name}</div>
            {isImage(preview.type)
              ? <img src={preview.url} alt={preview.name} style={{maxWidth:"80vw",maxHeight:"75vh",borderRadius:8,objectFit:"contain"}} />
              : <iframe src={preview.url} title={preview.name} style={{width:"75vw",height:"75vh",border:"none",borderRadius:8}} />
            }
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files)}}
        style={{
          border:`2px dashed ${dragOver?G.accent:G.border}`,
          borderRadius:12,background:dragOver?G.accentLight:"transparent",
          padding:"28px 20px",textAlign:"center",marginBottom:20,transition:"all .2s",cursor:"pointer"
        }}
        onClick={()=>document.getElementById("file-input-"+patient.id).click()}
      >
        <input id={"file-input-"+patient.id} type="file" multiple accept="image/*,.pdf" style={{display:"none"}} onChange={e=>handleFiles(e.target.files)} />
        {uploading
          ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              <div style={{width:18,height:18,border:`2px solid ${G.accentLight}`,borderTopColor:G.accent,borderRadius:"50%",animation:"spin .8s linear infinite"}} />
              <span style={{fontSize:13,color:G.textMid}}>{progress}</span>
            </div>
          : <>
              <div style={{fontSize:28,marginBottom:8}}>📎</div>
              <div style={{fontSize:14,fontWeight:500,color:G.textMid,marginBottom:4}}>Arrastra archivos aquí o haz clic para seleccionar</div>
              <div style={{fontSize:12,color:G.textLight}}>Imágenes (JPG, PNG) y PDFs · Se guardan automáticamente en Google Drive</div>
            </>
        }
      </div>

      {/* File list */}
      {files.length === 0 && !uploading && <EmptyState icon="🗂️" text="Sin archivos. Sube imágenes de estudios o PDFs de resultados." />}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        {files.map(f => (
          <div key={f.id} style={{background:G.surface,border:`1px solid ${G.border}`,borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            {/* Thumbnail / Icon */}
            <div
              onClick={()=>setPreview({url:f.viewUrl,name:f.fileName,type:f.mimeType})}
              style={{height:110,background:G.surfaceAlt,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,position:"relative"}}
            >
              {isImage(f.mimeType)
                ? <img src={f.viewUrl} alt={f.fileName} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex"}} />
                : null
              }
              <div style={{display:isImage(f.mimeType)?"none":"flex",fontSize:36,alignItems:"center",justifyContent:"center",width:"100%",height:"100%"}}>📄</div>
              <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0)",transition:"background .2s"}} onMouseEnter={e=>e.target.style.background="rgba(0,0,0,0.08)"} onMouseLeave={e=>e.target.style.background="rgba(0,0,0,0)"} />
            </div>

            {/* Info */}
            <div style={{padding:"10px 10px 8px",flex:1,display:"flex",flexDirection:"column",gap:6}}>
              <div style={{fontSize:12,fontWeight:500,color:G.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={f.fileName}>{f.fileName}</div>
              <input
                defaultValue={f.label}
                placeholder="Etiqueta (ej. BHC mayo)"
                onBlur={e=>updateLabel(f.id,e.target.value)}
                style={{fontSize:11,padding:"4px 7px",borderRadius:6,border:`1px solid ${G.border}`}}
              />
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:10,color:G.textLight}}>{fmt(f.uploadedAt)} · {formatSize(f.size||0)}</span>
                <div style={{display:"flex",gap:4}}>
                  <a href={f.viewUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:G.accent,textDecoration:"none"}}>↗ Drive</a>
                  <button onClick={()=>deleteFile(f.id)} style={{fontSize:10,color:G.danger,background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}>✕</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Patient List ─────────────────────────────────────────────────────────────
function PatientList({ patients, onSelect, onNew, selected }) {
  const [q, setQ] = useState("");
  const filtered = patients.filter(p =>
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(q.toLowerCase())
  ).sort((a,b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:G.surface,borderRight:`1px solid ${G.border}`}}>
      <div style={{padding:"20px 16px 12px",borderBottom:`1px solid ${G.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:600,color:G.accent}}>Expedientes</div>
            <div style={{fontSize:11,color:G.textLight,marginTop:1}}>{patients.length} pacientes registrados</div>
          </div>
          <Btn onClick={onNew} size="sm">＋ Nuevo</Btn>
        </div>
        <input placeholder="🔍  Buscar paciente..." value={q} onChange={e=>setQ(e.target.value)} style={{fontSize:13}} />
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {filtered.length===0 && <EmptyState icon="👤" text="No se encontraron pacientes" />}
        {filtered.map(p => (
          <div key={p.id} onClick={()=>onSelect(p)}
            style={{padding:"12px 16px",cursor:"pointer",borderBottom:`1px solid ${G.border}`,background:selected?.id===p.id?G.accentLight:"transparent",borderLeft:selected?.id===p.id?`3px solid ${G.accent}`:"3px solid transparent",transition:"all .15s"}}>
            <div style={{fontWeight:500,fontSize:14}}>{p.lastName}, {p.firstName}</div>
            <div style={{fontSize:12,color:G.textLight,marginTop:2}}>{calcAge(p.dob)} · {p.sex||"—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Patient Form ─────────────────────────────────────────────────────────────
function PatientForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || { firstName:"",lastName:"",dob:"",sex:"",phone:"",email:"",bloodType:"",allergies:"",hereditaryHistory:"",pathologicalHistory:"",nonPathologicalHistory:"" });
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  return (
    <div className="fade-in" style={{padding:24,overflowY:"auto",maxHeight:"100%",maxWidth:680}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:600,marginBottom:20,color:G.accent}}>{initial?.id?"Editar Paciente":"Nuevo Paciente"}</div>
      <Card style={{marginBottom:16}}>
        <div style={{fontWeight:600,fontSize:13,color:G.textMid,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Datos Generales</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
          <Field label="Nombre(s)"><input value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Apellidos"><input value={f.lastName} onChange={set("lastName")} /></Field>
          <Field label="Fecha de Nacimiento"><input type="date" value={f.dob} onChange={set("dob")} /></Field>
          <Field label="Sexo"><select value={f.sex} onChange={set("sex")}><option value="">Seleccionar...</option><option>Masculino</option><option>Femenino</option><option>Otro</option></select></Field>
          <Field label="Teléfono"><input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Correo electrónico"><input value={f.email} onChange={set("email")} /></Field>
          <Field label="Tipo de sangre"><select value={f.bloodType} onChange={set("bloodType")}><option value="">—</option>{["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(t=><option key={t}>{t}</option>)}</select></Field>
          <Field label="Alergias"><input value={f.allergies} onChange={set("allergies")} placeholder="Penicilina, AINES..." /></Field>
        </div>
      </Card>
      <Card style={{marginBottom:20}}>
        <div style={{fontWeight:600,fontSize:13,color:G.textMid,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Historia Clínica</div>
        <Field label="Antecedentes heredofamiliares"><textarea value={f.hereditaryHistory} onChange={set("hereditaryHistory")} /></Field>
        <Field label="Antecedentes patológicos personales"><textarea value={f.pathologicalHistory} onChange={set("pathologicalHistory")} /></Field>
        <Field label="Antecedentes no patológicos"><textarea value={f.nonPathologicalHistory} onChange={set("nonPathologicalHistory")} /></Field>
      </Card>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={()=>onSave(f)}>💾 Guardar paciente</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  );
}

// ─── Consultation Form ────────────────────────────────────────────────────────
function ConsultationForm({ patientId, initial, onSave, onCancel }) {
  const today = new Date().toISOString().split("T")[0];
  const [f, setF] = useState(initial||{date:today,reason:"",vitals:"",exploration:"",diagnosis:"",plan:"",notes:""});
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  return (
    <div className="fade-in">
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,marginBottom:16,color:G.accent}}>{initial?.id?"Editar Consulta":"Nueva Nota de Consulta"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <Field label="Fecha"><input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Motivo de consulta"><input value={f.reason} onChange={set("reason")} /></Field>
      </div>
      <Field label="Signos vitales"><input value={f.vitals} onChange={set("vitals")} placeholder="TA: 120/80, FC: 72, T: 36.5°C" /></Field>
      <Field label="Exploración física"><textarea value={f.exploration} onChange={set("exploration")} /></Field>
      <Field label="Diagnóstico(s)"><textarea value={f.diagnosis} onChange={set("diagnosis")} style={{minHeight:60}} /></Field>
      <Field label="Plan / Tratamiento"><textarea value={f.plan} onChange={set("plan")} /></Field>
      <Field label="Notas adicionales"><textarea value={f.notes} onChange={set("notes")} style={{minHeight:60}} /></Field>
      <div style={{display:"flex",gap:10,marginTop:4}}>
        <Btn onClick={()=>onSave({...f,patientId})}>💾 Guardar</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  );
}

// ─── Prescription Form ────────────────────────────────────────────────────────
function PrescriptionForm({ patientId, initial, onSave, onCancel }) {
  const today = new Date().toISOString().split("T")[0];
  const [f, setF] = useState(initial||{date:today,items:[{drug:"",dose:"",route:"",frequency:"",duration:"",instructions:""}]});
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const setItem = (i,k) => e => setF(p=>{const items=[...p.items];items[i]={...items[i],[k]:e.target.value};return{...p,items};});
  const addItem = () => setF(p=>({...p,items:[...p.items,{drug:"",dose:"",route:"",frequency:"",duration:"",instructions:""}]}));
  const removeItem = i => setF(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)}));
  return (
    <div className="fade-in">
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,marginBottom:16,color:G.accent}}>Nueva Receta</div>
      <Field label="Fecha"><input type="date" value={f.date} onChange={set("date")} style={{maxWidth:180}} /></Field>
      {f.items.map((item,i)=>(
        <Card key={i} style={{marginBottom:12,background:G.surfaceAlt}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:12,fontWeight:600,color:G.textMid}}>MEDICAMENTO {i+1}</span>
            {f.items.length>1 && <Btn variant="danger" size="sm" onClick={()=>removeItem(i)}>✕</Btn>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:"0 12px"}}>
            <Field label="Medicamento"><input value={item.drug} onChange={setItem(i,"drug")} placeholder="Amoxicilina 500mg" /></Field>
            <Field label="Dosis"><input value={item.dose} onChange={setItem(i,"dose")} /></Field>
            <Field label="Vía"><input value={item.route} onChange={setItem(i,"route")} placeholder="VO" /></Field>
            <Field label="Frecuencia"><input value={item.frequency} onChange={setItem(i,"frequency")} placeholder="c/8h" /></Field>
            <Field label="Duración"><input value={item.duration} onChange={setItem(i,"duration")} placeholder="7 días" /></Field>
          </div>
          <Field label="Indicaciones especiales"><input value={item.instructions} onChange={setItem(i,"instructions")} /></Field>
        </Card>
      ))}
      <Btn variant="ghost" size="sm" onClick={addItem} style={{marginBottom:16}}>＋ Agregar medicamento</Btn>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={()=>onSave({...f,patientId})}>💾 Guardar receta</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  );
}

// ─── Study Form ───────────────────────────────────────────────────────────────
function StudyForm({ patientId, initial, onSave, onCancel }) {
  const today = new Date().toISOString().split("T")[0];
  const [f, setF] = useState(initial||{date:today,type:"",name:"",laboratory:"",results:"",interpretation:"",notes:""});
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  return (
    <div className="fade-in">
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,marginBottom:16,color:G.accent}}>Registrar Estudio</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0 16px"}}>
        <Field label="Fecha"><input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Tipo de estudio"><select value={f.type} onChange={set("type")}><option value="">Seleccionar...</option><option>Laboratorio</option><option>Imagen</option><option>Electrocardiograma</option><option>Biopsía</option><option>Otro</option></select></Field>
        <Field label="Nombre del estudio"><input value={f.name} onChange={set("name")} placeholder="BHC, Glucosa, Rx Tórax..." /></Field>
      </div>
      <Field label="Laboratorio / Institución"><input value={f.laboratory} onChange={set("laboratory")} /></Field>
      <Field label="Resultados"><textarea value={f.results} onChange={set("results")} style={{minHeight:100}} /></Field>
      <Field label="Interpretación clínica"><textarea value={f.interpretation} onChange={set("interpretation")} /></Field>
      <Field label="Notas"><textarea value={f.notes} onChange={set("notes")} style={{minHeight:60}} /></Field>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={()=>onSave({...f,patientId})}>💾 Guardar estudio</Btn>
        <Btn variant="secondary" onClick={onCancel}>Cancelar</Btn>
      </div>
    </div>
  );
}

// ─── Patient Detail ───────────────────────────────────────────────────────────
function PatientDetail({ patient, data, persist, onEditPatient, onDeletePatient, onSaveConsultation, onSaveRx, onSaveStudy, onDeleteItem }) {
  const [tab, setTab] = useState("historia");
  const [modal, setModal] = useState(null);

  const consults = data.consultations.filter(c=>c.patientId===patient.id).sort((a,b)=>b.date.localeCompare(a.date));
  const rxs = data.prescriptions.filter(r=>r.patientId===patient.id).sort((a,b)=>b.date.localeCompare(a.date));
  const studies = data.studies.filter(s=>s.patientId===patient.id).sort((a,b)=>b.date.localeCompare(a.date));
  const filesCount = (data.files||[]).filter(f=>f.patientId===patient.id).length;

  const tabs = [
    {id:"historia",label:"Historia Clínica"},
    {id:"consultas",label:`Consultas (${consults.length})`},
    {id:"recetas",label:`Recetas (${rxs.length})`},
    {id:"estudios",label:`Estudios (${studies.length})`},
    {id:"archivos",label:`Archivos (${filesCount})`},
  ];

  const handleSave = async (type, item, saveFn) => { await saveFn(item); setModal(null); };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"20px 24px 0",borderBottom:`1px solid ${G.border}`,background:G.surface}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div style={{display:"flex",gap:16,alignItems:"center"}}>
            <div style={{width:52,height:52,borderRadius:"50%",background:G.accentLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,border:`2px solid ${G.accent}`}}>
              {patient.sex==="Femenino"?"👩":patient.sex==="Masculino"?"👨":"🧑"}
            </div>
            <div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,fontWeight:600}}>{patient.firstName} {patient.lastName}</div>
              <div style={{fontSize:13,color:G.textMid,display:"flex",gap:12,marginTop:2}}>
                <span>{calcAge(patient.dob)}</span><span>·</span><span>{patient.sex||"—"}</span>
                {patient.bloodType && <><span>·</span><span className="tag" style={{background:G.dangerLight,color:G.danger}}>🩸 {patient.bloodType}</span></>}
                {patient.allergies && <><span>·</span><span className="tag" style={{background:"#FFF8E1",color:G.gold}}>⚠ {patient.allergies}</span></>}
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="secondary" size="sm" onClick={onEditPatient}>✏️ Editar</Btn>
            <Btn variant="danger" size="sm" onClick={onDeletePatient}>🗑</Btn>
          </div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={tab===t.id?"tab-active":""}
              style={{padding:"8px 14px",fontSize:12,fontWeight:500,borderRadius:"8px 8px 0 0",background:tab===t.id?G.accent:"transparent",color:tab===t.id?"#fff":G.textMid,border:"none",cursor:"pointer",transition:"all .2s"}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:24}}>
        {modal && (
          <div className="fade-in" style={{marginBottom:24,background:G.surface,border:`1px solid ${G.border}`,borderRadius:12,padding:20}}>
            {modal.type==="consulta" && <ConsultationForm patientId={patient.id} initial={modal.initial} onSave={item=>handleSave("consulta",item,onSaveConsultation)} onCancel={()=>setModal(null)} />}
            {modal.type==="receta" && <PrescriptionForm patientId={patient.id} initial={modal.initial} onSave={item=>handleSave("receta",item,onSaveRx)} onCancel={()=>setModal(null)} />}
            {modal.type==="estudio" && <StudyForm patientId={patient.id} initial={modal.initial} onSave={item=>handleSave("estudio",item,onSaveStudy)} onCancel={()=>setModal(null)} />}
          </div>
        )}

        {/* HISTORIA */}
        {tab==="historia" && (
          <div className="fade-in" style={{maxWidth:680}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              {[["📅 Fecha de Nacimiento",fmt(patient.dob)],["📞 Teléfono",patient.phone||"—"],["✉️ Correo",patient.email||"—"]].map(([l,v])=>(
                <Card key={l} style={{padding:"12px 16px"}}><div style={{fontSize:11,color:G.textLight,marginBottom:4}}>{l}</div><div style={{fontSize:14}}>{v}</div></Card>
              ))}
            </div>
            {[["Antecedentes Heredofamiliares",patient.hereditaryHistory],["Antecedentes Patológicos Personales",patient.pathologicalHistory],["Antecedentes No Patológicos",patient.nonPathologicalHistory]].map(([title,content])=>(
              <Card key={title} style={{marginBottom:12}}>
                <div style={{fontWeight:600,fontSize:12,color:G.textMid,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>{title}</div>
                <div style={{fontSize:14,color:content?G.text:G.textLight,lineHeight:1.6}}>{content||"Sin registros"}</div>
              </Card>
            ))}
          </div>
        )}

        {/* CONSULTAS */}
        {tab==="consultas" && (
          <div className="fade-in">
            {!modal && <div style={{marginBottom:16}}><Btn onClick={()=>setModal({type:"consulta"})}>＋ Nueva consulta</Btn></div>}
            {consults.length===0&&!modal&&<EmptyState icon="📋" text="Sin consultas registradas" />}
            {consults.map(c=>(
              <Card key={c.id} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div><div style={{fontWeight:600,fontSize:15}}>{c.reason||"Consulta"}</div><div style={{fontSize:12,color:G.textLight}}>{fmt(c.date)}</div></div>
                  <Btn variant="danger" size="sm" onClick={()=>onDeleteItem("consultations",c.id)}>✕</Btn>
                </div>
                {c.vitals&&<div style={{fontSize:12,background:G.accentLight,padding:"6px 10px",borderRadius:6,marginBottom:8,color:G.accent}}>🫀 {c.vitals}</div>}
                {[["Exploración",c.exploration],["Diagnóstico",c.diagnosis],["Plan",c.plan],["Notas",c.notes]].filter(([,v])=>v).map(([l,v])=>(
                  <div key={l} style={{marginBottom:6}}><span style={{fontSize:11,fontWeight:600,color:G.textMid,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}: </span><span style={{fontSize:13}}>{v}</span></div>
                ))}
              </Card>
            ))}
          </div>
        )}

        {/* RECETAS */}
        {tab==="recetas" && (
          <div className="fade-in">
            {!modal&&<div style={{marginBottom:16}}><Btn onClick={()=>setModal({type:"receta"})}>＋ Nueva receta</Btn></div>}
            {rxs.length===0&&!modal&&<EmptyState icon="💊" text="Sin recetas registradas" />}
            {rxs.map(rx=>(
              <Card key={rx.id} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:12,color:G.textLight}}>📅 {fmt(rx.date)}</div>
                  <Btn variant="danger" size="sm" onClick={()=>onDeleteItem("prescriptions",rx.id)}>✕</Btn>
                </div>
                {rx.items?.map((item,i)=>(
                  <div key={i} style={{background:G.surfaceAlt,borderRadius:8,padding:"10px 14px",marginBottom:8,display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                    <div style={{fontWeight:600,fontSize:14,minWidth:160}}>{item.drug}</div>
                    <div style={{fontSize:12,color:G.textMid,display:"flex",gap:8,flexWrap:"wrap"}}>
                      {item.dose&&<span className="tag" style={{background:G.accentLight,color:G.accent}}>{item.dose}</span>}
                      {item.route&&<span>{item.route}</span>}{item.frequency&&<span>{item.frequency}</span>}{item.duration&&<span>· {item.duration}</span>}
                    </div>
                    {item.instructions&&<div style={{fontSize:12,color:G.textLight,width:"100%"}}>📌 {item.instructions}</div>}
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}

        {/* ESTUDIOS */}
        {tab==="estudios" && (
          <div className="fade-in">
            {!modal&&<div style={{marginBottom:16}}><Btn onClick={()=>setModal({type:"estudio"})}>＋ Registrar estudio</Btn></div>}
            {studies.length===0&&!modal&&<EmptyState icon="🔬" text="Sin estudios registrados" />}
            {studies.map(s=>(
              <Card key={s.id} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:15}}>{s.name||"Estudio"}</div>
                    <div style={{fontSize:12,color:G.textLight,display:"flex",gap:8}}>{fmt(s.date)}{s.type&&<span className="tag" style={{background:G.accentLight,color:G.accent}}>{s.type}</span>}{s.laboratory&&<span>· {s.laboratory}</span>}</div>
                  </div>
                  <Btn variant="danger" size="sm" onClick={()=>onDeleteItem("studies",s.id)}>✕</Btn>
                </div>
                {s.results&&<div style={{marginTop:8}}><div style={{fontSize:11,fontWeight:600,color:G.textMid,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Resultados</div><div style={{fontSize:13,lineHeight:1.6}}>{s.results}</div></div>}
                {s.interpretation&&<div style={{marginTop:8}}><div style={{fontSize:11,fontWeight:600,color:G.textMid,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Interpretación</div><div style={{fontSize:13,lineHeight:1.6}}>{s.interpretation}</div></div>}
              </Card>
            ))}
          </div>
        )}

        {/* ARCHIVOS */}
        {tab==="archivos" && (
          <FilesTab patient={patient} data={data} persist={persist} />
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  injectStyles();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list");

  useEffect(() => { loadAll().then(setData); }, []);

  const persist = useCallback(async (newData) => { setData(newData); await saveAll(newData); }, []);

  const savePatient = async (f) => {
    const isNew = !f.id;
    const patient = isNew ? {...f,id:uid()} : {...f};
    const patients = isNew ? [...data.patients,patient] : data.patients.map(p=>p.id===patient.id?patient:p);
    await persist({...data,patients});
    setSelected(patient); setView("list");
  };

  const deletePatient = async () => {
    if (!confirm(`¿Eliminar el expediente de ${selected.firstName} ${selected.lastName}?`)) return;
    await persist({
      ...data,
      patients: data.patients.filter(p=>p.id!==selected.id),
      consultations: data.consultations.filter(c=>c.patientId!==selected.id),
      prescriptions: data.prescriptions.filter(r=>r.patientId!==selected.id),
      studies: data.studies.filter(s=>s.patientId!==selected.id),
      files: (data.files||[]).filter(f=>f.patientId!==selected.id),
    });
    setSelected(null);
  };

  const saveConsultation = async (item) => {
    const isNew = !item.id; const entry = isNew?{...item,id:uid()}:item;
    await persist({...data,consultations:isNew?[...data.consultations,entry]:data.consultations.map(c=>c.id===entry.id?entry:c)});
  };
  const saveRx = async (item) => {
    const isNew = !item.id; const entry = isNew?{...item,id:uid()}:item;
    await persist({...data,prescriptions:isNew?[...data.prescriptions,entry]:data.prescriptions.map(r=>r.id===entry.id?entry:r)});
  };
  const saveStudy = async (item) => {
    const isNew = !item.id; const entry = isNew?{...item,id:uid()}:item;
    await persist({...data,studies:isNew?[...data.studies,entry]:data.studies.map(s=>s.id===entry.id?entry:s)});
  };
  const deleteItem = async (collection, id) => {
    if (!confirm("¿Eliminar este registro?")) return;
    await persist({...data,[collection]:data[collection].filter(i=>i.id!==id)});
  };

  if (!data) return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
      <div style={{width:36,height:36,border:`3px solid ${G.accentLight}`,borderTopColor:G.accent,borderRadius:"50%",animation:"spin .8s linear infinite"}} />
      <div style={{fontSize:13,color:G.textLight}}>Cargando expedientes...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{display:"flex",height:"100vh",overflow:"hidden",background:G.bg}}>
      <div style={{width:280,minWidth:280,height:"100%",overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <PatientList patients={data.patients} selected={selected} onSelect={p=>{setSelected(p);setView("list");}} onNew={()=>{setSelected(null);setView("newPatient");}} />
      </div>
      <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        {view==="newPatient" && <div style={{flex:1,overflowY:"auto",padding:24}}><PatientForm onSave={savePatient} onCancel={()=>setView("list")} /></div>}
        {view==="editPatient" && selected && <div style={{flex:1,overflowY:"auto",padding:24}}><PatientForm initial={selected} onSave={savePatient} onCancel={()=>setView("list")} /></div>}
        {view==="list" && !selected && (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:G.textLight}}>
            <div style={{fontSize:56}}>🏥</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:G.textMid}}>Sistema de Expedientes Clínicos</div>
            <div style={{fontSize:13}}>Selecciona un paciente o crea uno nuevo</div>
          </div>
        )}
        {view==="list" && selected && (
          <PatientDetail patient={selected} data={data} persist={persist}
            onEditPatient={()=>setView("editPatient")} onDeletePatient={deletePatient}
            onSaveConsultation={saveConsultation} onSaveRx={saveRx} onSaveStudy={saveStudy} onDeleteItem={deleteItem} />
        )}
      </div>
    </div>
  );
}
