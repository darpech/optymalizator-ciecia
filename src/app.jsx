import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, RotateCw, MousePointer2, Calculator, Layout, Settings, 
  Move, Maximize2, Sparkles, Loader2, X, Group, Ungroup, Palette, Printer,
  Circle as CircleIcon, PenTool, Scissors, BarChart3, Square, Copy
} from 'lucide-react';

// --- Funkcje Pomocnicze ---

const generateColor = () => `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`;
const generateStrokeColor = (hsl) => hsl ? hsl.replace('85%', '40%') : '#333';

// Obliczanie pola dla różnych kształtów
const calculateShapeArea = (shape) => {
  if (shape.type === 'rect') return (shape.width * shape.height) / 1000000;
  if (shape.type === 'circle') return (Math.PI * Math.pow(shape.width / 2, 2)) / 1000000;
  if (shape.type === 'ellipse') return (Math.PI * (shape.width / 2) * (shape.height / 2)) / 1000000;
  
  if (shape.type === 'polygon' || shape.type === 'freehand') {
    // Wzór "sznurowadłowy" (Shoelace formula) dla wielokątów
    if (!shape.points || shape.points.length < 3) return 0;
    let area = 0;
    const n = shape.points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += shape.points[i].x * shape.points[j].y;
      area -= shape.points[j].x * shape.points[i].y;
    }
    return Math.abs(area / 2) / 1000000; // Konwersja na m2
  }
  return 0; // Linie cięcia mają 0 powierzchni
};

export default function NestingApp() {
  const apiKey = ""; 

  // --- Stan Projektów (Multi-Project) ---
  const [projects, setProjects] = useState([
    {
      id: 1,
      name: 'Wariant A',
      sheet: { width: 1800, height: 3200 },
      density: 15,
      shapes: [
        { id: 101, type: 'rect', width: 400, height: 600, x: 50, y: 50, rotation: 0, name: 'Bok', color: 'hsl(200, 70%, 85%)', groupId: null },
        { id: 102, type: 'circle', width: 300, height: 300, x: 500, y: 50, rotation: 0, name: 'Otwór', color: 'hsl(140, 70%, 85%)', groupId: null }
      ]
    }
  ]);
  const [activeProjectId, setActiveProjectId] = useState(1);

  // Pobieranie aktywnego projektu
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];
  
  // Settery "pośrednie" do aktualizacji stanu aktywnego projektu w tablicy projects
  const setShapes = (newShapesOrFn) => {
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const newShapes = typeof newShapesOrFn === 'function' ? newShapesOrFn(p.shapes) : newShapesOrFn;
        return { ...p, shapes: newShapes };
      }
      return p;
    }));
  };
  
  const setSheet = (newSheet) => {
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, sheet: newSheet } : p));
  };
  const setDensity = (val) => {
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, density: val } : p));
  };
  const setProjectName = (name) => {
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, name: name } : p));
  };

  // --- Stan UI ---
  const [selectedIds, setSelectedIds] = useState([]);
  const [tool, setTool] = useState('select'); // select, rect, circle, polygon, freehand, cutline
  const [cutlineType, setCutlineType] = useState('straight'); // 'straight' | 'freehand'
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]); // Dla freehand/polygon
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 }); 
  const [initialShapePositions, setInitialShapePositions] = useState({}); 

  const [zoom, setZoom] = useState(0.3); 
  const [snapLines, setSnapLines] = useState([]); 
  const [isSnapped, setIsSnapped] = useState(false); 
  
  // Modale
  const [showAiModal, setShowAiModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const svgRef = useRef(null);
  const workspaceRef = useRef(null);

  // --- Statystyki ---
  const getProjectStats = (proj) => {
    const sheetArea = (proj.sheet.width * proj.sheet.height) / 1000000;
    let productArea = 0;
    proj.shapes.forEach(shape => {
      if (shape.type !== 'cutline') {
         productArea += calculateShapeArea(shape);
      }
    });
    const wasteArea = Math.max(0, sheetArea - productArea);
    const efficiency = sheetArea > 0 ? (productArea / sheetArea) * 100 : 0;
    const wasteWeight = wasteArea * proj.density;
    const totalWeight = sheetArea * proj.density;
    return { sheetArea, productArea, wasteArea, efficiency, wasteWeight, totalWeight };
  };

  const currentStats = useMemo(() => getProjectStats(activeProject), [activeProject]);

  // --- Funkcje AI ---
  const callGemini = async (prompt, systemInstruction) => {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], systemInstruction: { parts: [{ text: systemInstruction }] } }),
        }
      );
      if (!response.ok) throw new Error("API Error");
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (e) { console.error(e); alert("Błąd AI"); return null; }
  };

  const generateProjectWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    const systemPrompt = `Zwróć JSON tablicę: { "name", "width", "height", "count", "type" ("rect"|"circle") }.`;
    const result = await callGemini(`Zbuduj: ${aiPrompt}`, systemPrompt);
    if (result) {
      try {
        const parts = JSON.parse(result.replace(/```json|```/g, '').trim());
        const newShapes = [];
        let cx = 20, cy = 20;
        parts.forEach((p, idx) => {
          for(let i=0; i<p.count; i++) {
            newShapes.push({
              id: Date.now() + idx*100 + i, type: p.type || 'rect',
              width: p.width, height: p.height || p.width,
              x: cx, y: cy, rotation: 0, name: p.name,
              color: generateColor(), groupId: null
            });
            cx += 50; cy += 50;
          }
        });
        setShapes(prev => [...prev, ...newShapes]);
        setShowAiModal(false);
      } catch (e) { alert("Błąd danych AI"); }
    }
    setIsGenerating(false);
  };

  // --- Obsługa Projektów ---
  const addNewProject = () => {
    const newId = Date.now();
    setProjects([...projects, {
      id: newId,
      name: `Wariant ${String.fromCharCode(65 + projects.length)}`,
      sheet: { ...activeProject.sheet },
      density: activeProject.density,
      shapes: JSON.parse(JSON.stringify(activeProject.shapes)) // Klonuj obecne kształty jako bazę
    }]);
    setActiveProjectId(newId);
  };

  const deleteProject = (e, id) => {
    e.stopPropagation();
    if (projects.length === 1) return;
    const newProjs = projects.filter(p => p.id !== id);
    setProjects(newProjs);
    if (activeProjectId === id) setActiveProjectId(newProjs[0].id);
  };

  // --- Dodawanie Kształtów (Toolbox) ---
  const addShape = (type) => {
    const newShape = {
      id: Date.now(),
      type: type, // rect, circle, ellipse, polygon
      x: 50, y: 50,
      rotation: 0,
      name: 'Nowy',
      color: generateColor(),
      groupId: null
    };

    if (type === 'rect') { newShape.width = 400; newShape.height = 600; }
    else if (type === 'circle') { newShape.width = 300; newShape.height = 300; } // radius * 2
    else if (type === 'l-shape') {
      newShape.type = 'polygon';
      newShape.points = [{x:0,y:0}, {x:200,y:0}, {x:200,y:400}, {x:100,y:400}, {x:100,y:100}, {x:0,y:100}];
      newShape.name = 'Kształt L';
      newShape.width = 200; newShape.height = 400; // Bounding box for selection
    }

    setShapes(prev => [...prev, newShape]);
    setSelectedIds([newShape.id]);
    setTool('select');
  };

  // --- Interakcje Myszki (Drag & Draw) ---

  const handleMouseDown = (e, shapeId = null) => {
    // 1. Tryb Rysowania (Freehand / Cutline)
    if (tool === 'freehand' || tool === 'cutline') {
       e.stopPropagation();
       setIsDrawing(true);
       const pt = getSvgPoint(e);
       
       if (tool === 'cutline' && cutlineType === 'straight') {
           // Dla prostej linii startujemy z dwoma identycznymi punktami (początek i koniec)
           setCurrentPoints([{x: pt.x, y: pt.y}, {x: pt.x, y: pt.y}]);
       } else {
           // Dla freehand dodajemy pierwszy punkt
           setCurrentPoints([{x: pt.x, y: pt.y}]);
       }
       return;
    }

    // 2. Tryb Select - jeśli kliknięto w tło, odznacz
    if (shapeId === null) {
       if (tool === 'select') setSelectedIds([]);
       return;
    }

    // 3. Tryb Select - Dragging
    if (tool !== 'select') return;
    
    e.stopPropagation();
    let newSel = [...selectedIds];
    const clicked = activeProject.shapes.find(s => s.id === shapeId);
    
    if (e.shiftKey) {
       if (newSel.includes(shapeId)) newSel = newSel.filter(id => id !== shapeId);
       else newSel.push(shapeId);
       // Zaznacz grupę
       if (clicked.groupId) {
          const group = activeProject.shapes.filter(s => s.groupId === clicked.groupId).map(s => s.id);
          group.forEach(id => { if(!newSel.includes(id)) newSel.push(id) });
       }
    } else {
       if (!newSel.includes(shapeId)) {
         newSel = [shapeId];
         if (clicked.groupId) {
             newSel = activeProject.shapes.filter(s => s.groupId === clicked.groupId).map(s => s.id);
         }
       }
    }
    
    setSelectedIds(newSel);
    setIsDragging(true);
    const pt = getSvgPoint(e);
    setDragStartPos({ x: pt.x, y: pt.y });
    
    const initPos = {};
    activeProject.shapes.forEach(s => {
       if(newSel.includes(s.id)) initPos[s.id] = { x: s.x, y: s.y };
    });
    setInitialShapePositions(initPos);
  };

  const handleMouseMove = (e) => {
    const pt = getSvgPoint(e);

    // Obsługa Rysowania
    if (isDrawing) {
       if (tool === 'freehand') {
          setCurrentPoints(prev => [...prev, {x: pt.x, y: pt.y}]);
       } else if (tool === 'cutline') {
          if (cutlineType === 'freehand') {
              setCurrentPoints(prev => [...prev, {x: pt.x, y: pt.y}]);
          } else {
              // Tryb prosty: aktualizuj tylko drugi punkt (koniec linii)
              setCurrentPoints(prev => [prev[0], {x: pt.x, y: pt.y}]);
          }
       }
       return;
    }

    // Obsługa Przesuwania
    if (!isDragging || selectedIds.length === 0) return;

    const dx = pt.x - dragStartPos.x;
    const dy = pt.y - dragStartPos.y;

    let snapX = 0, snapY = 0;
    let lines = [];
    let snapped = false;
    const anchor = activeProject.shapes.find(s => s.id === selectedIds[0]);
    
    if (anchor && anchor.type !== 'cutline') { 
        const w = anchor.width || 0; 
        const h = anchor.height || 0;
        const initial = initialShapePositions[anchor.id];
        const px = initial.x + dx;
        const py = initial.y + dy;
        const SNAP = 15 / zoom;

        // Do krawędzi arkusza
        if (Math.abs(px) < SNAP) { snapX = -px; lines.push({x1:0,y1:0,x2:0,y2:activeProject.sheet.height}); snapped=true;} 
        if (Math.abs(py) < SNAP) { snapY = -py; lines.push({x1:0,y1:0,x2:activeProject.sheet.width,y2:0}); snapped=true;}
    }

    setSnapLines(lines);
    setIsSnapped(snapped);

    setShapes(prev => prev.map(s => {
       if (selectedIds.includes(s.id)) {
          const init = initialShapePositions[s.id];
          if(!init) return s;
          return { ...s, x: init.x + dx + snapX, y: init.y + dy + snapY };
       }
       return s;
    }));
  };

  const handleMouseUp = () => {
    if (isDrawing) {
       setIsDrawing(false);
       
       // Walidacja: dla freehand min 3 punkty, dla prostej min 2
       const minPoints = (tool === 'cutline' && cutlineType === 'straight') ? 2 : 3;

       if (currentPoints.length >= minPoints) {
           // Finalizacja kształtu
           const minX = Math.min(...currentPoints.map(p => p.x));
           const minY = Math.min(...currentPoints.map(p => p.y));
           
           // Znormalizuj punkty względem bounding boxa (x,y)
           const relPoints = currentPoints.map(p => ({ x: p.x - minX, y: p.y - minY }));
           
           // Oblicz szer/wys bounding boxa
           const width = Math.max(...relPoints.map(p => p.x));
           const height = Math.max(...relPoints.map(p => p.y));

           // Unikaj tworzenia linii o zerowej długości
           if (width > 1 || height > 1) {
               const newShape = {
                   id: Date.now(),
                   type: tool === 'freehand' ? 'freehand' : 'cutline',
                   x: minX, y: minY,
                   width: width, height: height,
                   points: relPoints,
                   rotation: 0,
                   name: tool === 'cutline' ? 'Cięcie' : 'Kształt ręczny',
                   color: tool === 'cutline' ? 'transparent' : generateColor(),
                   groupId: null
               };
               setShapes(prev => [...prev, newShape]);
               if (tool !== 'cutline') setSelectedIds([newShape.id]);
           }
       }
       
       if (tool !== 'cutline') setTool('select'); 
       setCurrentPoints([]);
    }

    setIsDragging(false);
    setSnapLines([]);
    setIsSnapped(false);
  };

  const getSvgPoint = (e) => {
    if (!svgRef.current) return {x:0,y:0};
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svgRef.current.getScreenCTM().inverse());
  };

  // --- Operacje na Kształtach ---
  const rotateSelected = () => {
    setShapes(prev => prev.map(s => {
      if (selectedIds.includes(s.id)) return { ...s, rotation: (s.rotation + 90) % 360 };
      return s;
    }));
  };
  
  const groupSelected = () => {
    const gid = Date.now().toString();
    const color = generateColor();
    setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, groupId: gid, color: s.type==='cutline'?'transparent':color } : s));
  };

  const ungroupSelected = () => {
    setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, groupId: null } : s));
  };

  const removeSelected = () => {
    setShapes(prev => prev.filter(s => !selectedIds.includes(s.id)));
    setSelectedIds([]);
  };

  // --- Renderowanie Kształtu (SVG) ---
  const renderShape = (shape, isSelected) => {
     const strokeColor = shape.type === 'cutline' ? '#dc2626' : generateStrokeColor(shape.color);
     const strokeWidth = isSelected ? (2/zoom) : (shape.type === 'cutline' ? 2/zoom : 1);
     const strokeDash = shape.type === 'cutline' ? "10,10" : (isSelected ? "5,5" : "none");
     
     // Obliczenie środka do obrotu
     const cx = shape.width/2;
     const cy = shape.height/2;

     let innerElement;
     if (shape.type === 'rect') {
         innerElement = <rect width={shape.width} height={shape.height} rx="2" fill={shape.color} stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray={strokeDash} />;
     } else if (shape.type === 'circle') {
         innerElement = <circle cx={cx} cy={cy} r={shape.width/2} fill={shape.color} stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray={strokeDash} />;
     } else if (shape.type === 'polygon' || shape.type === 'freehand') {
         const d = `M ${shape.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
         innerElement = <path d={d} fill={shape.color} stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray={strokeDash} strokeLinejoin="round"/>;
     } else if (shape.type === 'cutline') {
         const d = `M ${shape.points.map(p => `${p.x},${p.y}`).join(' L ')}`;
         innerElement = <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray={strokeDash} />;
     }

     return (
        <g 
          key={shape.id}
          transform={`translate(${shape.x}, ${shape.y}) rotate(${shape.rotation}, ${cx}, ${cy})`}
          onMouseDown={(e) => handleMouseDown(e, shape.id)}
          className="cursor-move group"
          style={{ opacity: isDragging && isSelected ? 0.8 : 1 }}
        >
           {/* Obramowanie przy snappingu */}
           {isSelected && isDragging && isSnapped && (
              <rect x="-5" y="-5" width={shape.width+10} height={shape.height+10} fill="none" stroke="#22c55e" strokeWidth={2/zoom} />
           )}

           {innerElement}

           {/* Ikony i Teksty */}
           {shape.type !== 'cutline' && (
              <>
                {isSelected && (
                    <circle cx={shape.width} cy={shape.height} r={5/zoom} fill="#3b82f6" /> // Uchwyt (wizualny)
                )}
                {(isSelected || zoom > 0.5) && shape.width > 40 && (
                   <foreignObject x="0" y="0" width={shape.width} height={shape.height} className="pointer-events-none">
                     <div className="w-full h-full flex flex-col justify-center items-center text-center p-1 overflow-hidden">
                        <span className="text-[10px] font-bold bg-white/60 px-1 rounded truncate max-w-full">{shape.name}</span>
                        {isSelected && <span className="text-[8px] bg-white/60 px-1 mt-0.5">{calculateShapeArea(shape).toFixed(3)}m²</span>}
                     </div>
                   </foreignObject>
                )}
              </>
           )}
        </g>
     );
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <header className="bg-white border-b border-slate-200 px-4 py-2 flex justify-between items-center shadow-sm z-20 h-16">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-1.5 rounded-lg text-white"><Layout size={20} /></div>
          <div>
             <h1 className="text-lg font-bold leading-tight">Optymalizator Pro <span className="text-indigo-600">CAD</span></h1>
             {/* Pasek Projektów */}
             <div className="flex gap-1 mt-1">
                {projects.map(p => (
                   <div key={p.id} 
                        onClick={() => setActiveProjectId(p.id)}
                        className={`group flex items-center gap-1 text-[10px] px-2 py-0.5 rounded cursor-pointer border ${activeProjectId === p.id ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                      {p.name}
                      <X size={10} className="opacity-0 group-hover:opacity-100 hover:text-red-500" onClick={(e)=>deleteProject(e, p.id)}/>
                   </div>
                ))}
                <button onClick={addNewProject} className="p-0.5 hover:bg-slate-100 rounded text-slate-400"><Plus size={12}/></button>
             </div>
          </div>
        </div>
        
        <div className="flex gap-2">
           <button onClick={() => setShowCompareModal(true)} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50">
             <BarChart3 size={14} /> Porównaj
           </button>
           <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-1.5 rounded-md text-xs font-semibold">
             <Printer size={14} /> Raport
           </button>
           <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-md border border-indigo-100">
             <Calculator size={14} className="text-indigo-600"/>
             <span className="text-xs font-bold text-indigo-900">{currentStats.efficiency.toFixed(1)}% Eff.</span>
           </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* --- TOOLBAR (LEWY) --- */}
        <div className="w-12 bg-white border-r border-slate-200 flex flex-col items-center py-4 gap-3 z-10 shadow-sm">
           <ToolBtn icon={MousePointer2} active={tool === 'select'} onClick={() => setTool('select')} title="Wybierz (V)" />
           <div className="w-6 border-b border-slate-100"></div>
           <ToolBtn icon={Square} onClick={() => addShape('rect')} title="Dodaj Prostokąt" />
           <ToolBtn icon={CircleIcon} onClick={() => addShape('circle')} title="Dodaj Koło" />
           <ToolBtn icon={Layout} onClick={() => addShape('l-shape')} title="Dodaj Kształt L" />
           <div className="w-6 border-b border-slate-100"></div>
           <ToolBtn icon={PenTool} active={tool === 'freehand'} onClick={() => setTool('freehand')} title="Rysuj (P)" />
           <ToolBtn icon={Scissors} active={tool === 'cutline'} onClick={() => setTool('cutline')} title="Linia Cięcia (C)" />
        </div>

        {/* --- SIDEBAR (PRAWY - Ustawienia) --- */}
        <aside className="w-72 bg-white border-l border-slate-200 flex flex-col overflow-y-auto z-10 absolute right-0 top-0 bottom-0 shadow-lg">
             <div className="p-4 border-b border-slate-100 bg-slate-50/50">
               <h3 className="font-bold text-xs text-slate-500 uppercase mb-2">Projekt</h3>
               <input type="text" value={activeProject.name} onChange={(e)=>setProjectName(e.target.value)} className="w-full text-sm font-bold border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none bg-transparent mb-2"/>
               
               <div className="grid grid-cols-2 gap-2 mb-2">
                 <div>
                   <label className="text-[9px] font-bold text-slate-400 uppercase">Szer.</label>
                   <input type="number" value={activeProject.sheet.width} onChange={(e)=>setSheet({...activeProject.sheet, width:Number(e.target.value)})} className="w-full p-1 text-xs border rounded"/>
                 </div>
                 <div>
                   <label className="text-[9px] font-bold text-slate-400 uppercase">Wys.</label>
                   <input type="number" value={activeProject.sheet.height} onChange={(e)=>setSheet({...activeProject.sheet, height:Number(e.target.value)})} className="w-full p-1 text-xs border rounded"/>
                 </div>
               </div>
               <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Waga (kg/m²)</span>
                  <input type="number" value={activeProject.density} onChange={(e)=>setDensity(Number(e.target.value))} className="w-12 p-1 border rounded text-right"/>
               </div>
             </div>

             <div className="p-4 flex-1">
                <div className="flex justify-between items-center mb-3">
                   <h3 className="font-bold text-xs text-slate-500 uppercase">Elementy</h3>
                   <div className="flex gap-1">
                      <button onClick={rotateSelected} className="p-1 hover:bg-slate-100 rounded" title="Obróć"><RotateCw size={14}/></button>
                      <button onClick={removeSelected} className="p-1 hover:bg-red-50 text-red-500 rounded" title="Usuń"><Trash2 size={14}/></button>
                   </div>
                </div>
                
                {selectedIds.length > 0 ? (
                   <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 mb-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-xs font-bold text-indigo-800">{selectedIds.length} zaznaczonych</span>
                        {selectedIds.length > 1 && (
                          <div className="flex gap-1">
                            <button onClick={groupSelected}><Group size={14} className="text-indigo-600"/></button>
                            <button onClick={ungroupSelected}><Ungroup size={14} className="text-indigo-600"/></button>
                          </div>
                        )}
                      </div>
                      {/* Edycja Wymiarów (Tylko dla rect/circle) */}
                      {selectedIds.length === 1 && (
                        ['rect','circle'].includes(activeProject.shapes.find(s=>s.id===selectedIds[0])?.type) && (
                          <div className="grid grid-cols-2 gap-2 mb-2">
                             <input type="number" 
                               placeholder="Szer"
                               value={activeProject.shapes.find(s=>s.id===selectedIds[0]).width} 
                               onChange={(e)=>setShapes(prev=>prev.map(s=>s.id===selectedIds[0]?{...s,width:Number(e.target.value)}:s))}
                               className="p-1 text-xs border rounded"
                             />
                             <input type="number" 
                               placeholder="Wys"
                               value={activeProject.shapes.find(s=>s.id===selectedIds[0]).height} 
                               onChange={(e)=>setShapes(prev=>prev.map(s=>s.id===selectedIds[0]?{...s,height:Number(e.target.value)}:s))}
                               className="p-1 text-xs border rounded"
                             />
                          </div>
                        )
                      )}
                   </div>
                ) : (
                  <div className="text-center py-6 text-slate-400 border-2 border-dashed border-slate-100 rounded-lg mb-4">
                    <p className="text-xs">Wybierz element</p>
                  </div>
                )}

                {/* Statystyki Bieżące */}
                <div className="space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between"><span>Odpad:</span> <span className="text-red-500 font-bold">{currentStats.wasteArea.toFixed(2)} m²</span></div>
                    <div className="flex justify-between"><span>Waga odpadu:</span> <span>{currentStats.wasteWeight.toFixed(1)} kg</span></div>
                    <div className="flex justify-between"><span>Całkowita waga:</span> <span>{currentStats.totalWeight.toFixed(1)} kg</span></div>
                </div>
                
                <button onClick={() => setShowAiModal(true)} className="w-full mt-6 flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white py-2 rounded-lg text-xs font-bold">
                   <Sparkles size={14} /> Generator AI
                </button>
             </div>
        </aside>

        {/* --- WORKSPACE --- */}
        <div className="flex-1 bg-slate-100 overflow-hidden flex flex-col mr-72" ref={workspaceRef}>
            <div className="absolute top-2 left-16 z-10 flex gap-2 items-center">
               <div className="bg-white/80 backdrop-blur px-2 py-1 rounded text-xs border border-slate-200 shadow-sm flex items-center">
                  <span className="mr-2">Tryb: <b>{tool === 'freehand' ? 'Rysowanie' : tool === 'cutline' ? 'Linia Cięcia' : 'Wybieranie'}</b></span>
                  
                  {tool === 'cutline' && (
                    <div className="ml-2 flex bg-slate-100 rounded p-0.5 border border-slate-200">
                        <button onClick={() => setCutlineType('straight')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${cutlineType === 'straight' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-500 hover:text-indigo-500'}`}>Prosta</button>
                        <button onClick={() => setCutlineType('freehand')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${cutlineType === 'freehand' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-500 hover:text-indigo-500'}`}>Odręczna</button>
                    </div>
                  )}

                  {tool === 'freehand' && <span className="ml-2 text-slate-500 text-[10px]">(Narysuj i puść)</span>}
                  {tool === 'cutline' && cutlineType === 'straight' && <span className="ml-2 text-slate-500 text-[10px]">(Przeciągnij)</span>}
               </div>
            </div>

            <div className="absolute top-2 right-4 flex bg-white rounded-lg shadow-sm border border-slate-200 z-10">
               <button onClick={() => setZoom(z => z - 0.1)} className="p-1.5 px-3 hover:bg-slate-50 border-r text-slate-600">-</button>
               <span className="p-1.5 px-2 text-xs flex items-center">{Math.round(zoom*100)}%</span>
               <button onClick={() => setZoom(z => z + 0.1)} className="p-1.5 px-3 hover:bg-slate-50 text-slate-600">+</button>
            </div>

            <div className="flex-1 overflow-auto p-12 flex justify-center items-start cursor-crosshair" 
                 onMouseMove={handleMouseMove} 
                 onMouseUp={handleMouseUp}
                 onMouseDown={(e) => {
                     // Kliknięcie w pusty obszar workspace (poza SVG) - opcjonalnie reset selekcji
                     if (e.target === e.currentTarget) setSelectedIds([]);
                 }}
            >
              <div style={{ width: activeProject.sheet.width * zoom, height: activeProject.sheet.height * zoom }} className="relative shadow-2xl bg-white border border-slate-300">
                  <svg 
                     ref={svgRef}
                     width="100%" height="100%" 
                     viewBox={`0 0 ${activeProject.sheet.width} ${activeProject.sheet.height}`}
                     onMouseDown={(e) => handleMouseDown(e, null)} // Tło
                  >
                     <defs>
                        <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                           <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#f1f5f9" strokeWidth="1"/>
                        </pattern>
                     </defs>
                     <rect width="100%" height="100%" fill="url(#grid)" />
                     
                     {/* Linie Snappingu */}
                     {snapLines.map((l,i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#22c55e" strokeWidth={1/zoom} strokeDasharray="5,5"/>)}

                     {/* Kształty */}
                     {activeProject.shapes.map(shape => renderShape(shape, selectedIds.includes(shape.id)))}

                     {/* Rysowanie w toku (Freehand/Cutline) */}
                     {isDrawing && currentPoints.length > 0 && (
                        <path 
                           d={`M ${currentPoints.map(p => `${p.x},${p.y}`).join(' L ')}`} 
                           fill="none" 
                           stroke={tool==='cutline' ? 'red' : 'blue'} 
                           strokeWidth={2/zoom} 
                           strokeDasharray={tool==='cutline'?"5,5":"none"}
                        />
                     )}
                  </svg>
              </div>
            </div>
        </div>
      </div>

      {/* --- MODALE --- */}

      {/* AI Modal */}
      {showAiModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-white p-6 rounded-xl shadow-2xl w-96 max-w-full">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles className="text-purple-600"/> Generator AI</h2>
              <textarea className="w-full border p-2 rounded mb-4 h-24 text-sm" placeholder="Np. 4 koła o średnicy 20cm i 2 prostokąty 50x100..." value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}></textarea>
              <div className="flex gap-2">
                 <button onClick={()=>setShowAiModal(false)} className="flex-1 py-2 border rounded hover:bg-slate-50">Anuluj</button>
                 <button onClick={generateProjectWithAI} disabled={isGenerating} className="flex-1 py-2 bg-slate-900 text-white rounded flex justify-center items-center gap-2">
                    {isGenerating ? <Loader2 className="animate-spin"/> : "Generuj"}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Compare Modal */}
      {showCompareModal && (
         <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-white p-6 rounded-xl shadow-2xl w-[600px] max-w-full max-h-[80vh] overflow-auto">
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3/> Porównanie Wariantów</h2>
                 <button onClick={()=>setShowCompareModal(false)}><X/></button>
              </div>
              
              <table className="w-full text-sm text-left">
                 <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                    <tr>
                       <th className="p-3">Wariant</th>
                       <th className="p-3">Efektywność</th>
                       <th className="p-3">Odpad (m²)</th>
                       <th className="p-3">Odpad (kg)</th>
                       <th className="p-3">Akcja</th>
                    </tr>
                 </thead>
                 <tbody>
                    {projects.map(p => {
                       const s = getProjectStats(p);
                       const isBest = Math.max(...projects.map(prj => getProjectStats(prj).efficiency)) === s.efficiency;
                       return (
                          <tr key={p.id} className={`border-b ${isBest ? 'bg-green-50' : ''}`}>
                             <td className="p-3 font-bold">{p.name} {isBest && '🏆'}</td>
                             <td className={`p-3 font-mono ${s.efficiency > 85 ? 'text-green-600 font-bold' : ''}`}>{s.efficiency.toFixed(1)}%</td>
                             <td className="p-3 font-mono">{s.wasteArea.toFixed(3)}</td>
                             <td className="p-3 font-mono">{s.wasteWeight.toFixed(2)}</td>
                             <td className="p-3">
                                {p.id !== activeProjectId && (
                                   <button onClick={()=>{setActiveProjectId(p.id); setShowCompareModal(false)}} className="text-indigo-600 hover:underline">Otwórz</button>
                                )}
                             </td>
                          </tr>
                       )
                    })}
                 </tbody>
              </table>
              <p className="mt-4 text-xs text-slate-500">
                 * Najlepszy wynik oznaczony kolorem zielonym i pucharem. Linie cięcia nie wliczają się do powierzchni produktów.
              </p>
           </div>
         </div>
      )}

      {/* Hidden Print Styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .flex-1, .flex-1 * { visibility: visible; }
          .flex-1 { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
          header, aside, .absolute, .w-12 { display: none !important; }
        }
      `}</style>

    </div>
  );
}

// Komponent Przycisku Narzędzi
const ToolBtn = ({ icon: Icon, active, onClick, title }) => (
  <button 
    onClick={onClick} 
    title={title}
    className={`p-2 rounded-lg transition-all ${active ? 'bg-indigo-100 text-indigo-700 shadow-inner' : 'text-slate-500 hover:bg-slate-100'}`}
  >
    <Icon size={20} />
  </button>
);