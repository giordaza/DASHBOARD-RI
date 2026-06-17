import React, { useState, useEffect, useRef, useMemo } from 'react';

// =============================================================
//  UTILIDADES
// =============================================================

const norm = (v) => String(v ?? '').trim().toUpperCase();

// Parseo numérico tolerante a comas decimales / miles (Excel en español)
const parseNum = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
};

// Coordenadas: aceptan número o texto con coma decimal (ej. "4,5399684")
const parseCoord = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === undefined || v === null) return NaN;
    let s = String(v).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
};

const parseIntSafe = (v) => {
    if (typeof v === 'number') return Math.round(v);
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) ? n : 0;
};

// Diccionario de columnas. Cubre AMBOS archivos y hoja de eliminados
const F = {
    lat:        ['LATITUD', 'LATITUD ', 'Latitud', 'LAT'],
    lng:        ['LONGITUD', 'LONGITUD ', 'Longitud', 'LNG', 'LON'],
    ruta:       ['RUTA', 'RUTA ', 'Ruta'],
    ciudad:     ['CIUDAD', 'CIUDAD ', 'Ciudad'],
    regional:   ['REGIONAL VYM', 'REGIONAL', 'REGIONAL ', 'REGION', 'REGIÓN', 'Regional'],
    supervisor: ['SUPERVISOR', 'NOMBRE SUPERVISOR ', 'NOMBRE SUPERVISOR', 'USUARIO SUPERVISOR', 'Supervisor'],
    actividad:  ['ACTIVIDAD', 'ACTIVIDAD ', 'Actividad', 'TIPO ACTIVIDAD', 'Tipo Actividad', 'ACTIVIDAD VYM'],
    pdv:        ['PUNTO DE VENTA', 'PUNTO DE VENTA ', 'Punto de Venta'],
    codigo:     ['ID', 'Id', 'Codigo  PDV', 'Codigo PDV', 'CODIGO PDV', 'Código PDV', 'CÓDIGO PDV'], // Prioridad a ID
    cadena:     ['CADENA', 'SUBCADENA', 'Cadena', 'TIPO CLIENTE'], 
    frecuencia: ['FRECUENCIA', 'FRECUENCIA ', 'Frecuencia'],
    hrs:        ['TOTAL HRS B', 'Total Hrs B', 'HRS B', 'HRS', 'Hrs'],
    desp:       ['DESPLAZAMIENTO', 'TOTAL TIEMPO DEZPLASAMIENTO', 'TOTAL TIEMPO DESPLAZAMIENTO', 'TIEMPO DESPLAZAMIENTO', 'Desplazamiento'],
    decil:      ['DECIL', 'Decil', 'decil'],
    impTotal:   ['IMP TOTAL', 'Imp Total', 'IMP', 'IMPORTE TOTAL', 'Imp total', 'IMPORTE', 'PONDERADO'],
};

const get = (row, keys) => {
    if (!row) return undefined;
    const rowKeys = Object.keys(row);
    for (const k of keys) {
        // Limpiamos de espacios dobles y bordes tanto la llave buscada como la de Excel
        const target = k.trim().toUpperCase().replace(/\s+/g, ' ');
        const foundKey = rowKeys.find(rk => rk.trim().toUpperCase().replace(/\s+/g, ' ') === target);
        if (foundKey) {
            const val = row[foundKey];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
                return val;
            }
        }
    }
    return undefined;
};

// Fallback de color (rutas sin entrada en la paleta)
const stringToColor = (str) => {
    if (!str) return '#94a3b8';
    str = String(str);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).substr(-2);
    return color;
};

// Paleta estable y bien diferenciada para N usuarios/rutas
const buildColorMap = (routes) => {
    const sorted = [...new Set(routes.map((r) => String(r).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const n = sorted.length || 1;
    const map = {};
    sorted.forEach((r, i) => {
        const hue = Math.round((i * 360 / n + (i % 2) * 180) % 360);
        const sat = 62 + (i % 3) * 9;
        const light = 44 + (i % 4) * 6;
        map[r] = `hsl(${hue}, ${sat}%, ${light}%)`;
    });
    return map;
};

// ¿La fila cumple los filtros indicados?
const rowMatches = (row, f) => {
    if (f.CIUDAD && norm(get(row, F.ciudad)) !== norm(f.CIUDAD)) return false;
    if (f.REGIONAL && norm(get(row, F.regional)) !== norm(f.REGIONAL)) return false;
    if (f.CADENA && norm(get(row, F.cadena)) !== norm(f.CADENA)) return false; 
    if (f.RUTA && norm(get(row, F.ruta)) !== norm(f.RUTA)) return false;
    if (f.SUPERVISOR && norm(get(row, F.supervisor)) !== norm(f.SUPERVISOR)) return false;
    if (f.ACTIVIDAD && norm(get(row, F.actividad)) !== norm(f.ACTIVIDAD)) return false;
    return true;
};

const FIELD_KEYS = { CIUDAD: F.ciudad, REGIONAL: F.regional, CADENA: F.cadena, RUTA: F.ruta, SUPERVISOR: F.supervisor, ACTIVIDAD: F.actividad };

// Opciones de un filtro (en cascada con los demás filtros activos del MISMO lado)
const optionsFor = (baseRows, filters, field) => {
    const others = { ...filters, [field]: '' };
    const set = new Set();
    (baseRows || []).filter((r) => rowMatches(r, others)).forEach((r) => {
        const v = get(r, FIELD_KEYS[field]);
        if (v !== undefined && String(v).trim() !== '') set.add(String(v).trim());
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
};

// Aplica filtros a un lado (base + desplazamiento) de forma independiente
const filterSide = (base, desp, filters) => {
    const anyActive = Object.values(filters).some(Boolean);
    if (!anyActive) return { base: base || [], desp: desp || [] };
    const b = (base || []).filter((r) => rowMatches(r, filters));
    const allowed = new Set(b.map((r) => norm(get(r, F.ruta))).filter(Boolean));
    const d = (desp || []).filter((r) => allowed.has(norm(get(r, F.ruta))));
    return { base: b, desp: d };
};

// Resumen por ruta (idéntico para ambos lados).
const computeRouteSummary = (baseRows, despRows, colorMap) => {
    const grouped = {};
    (baseRows || []).forEach((row) => {
        const r = String(get(row, F.ruta) ?? '').trim();
        if (!r) return;
        if (!grouped[r]) grouped[r] = { hrsServ: 0, desp: 0, pdv: 0, frec: 0 };
        grouped[r].hrsServ += parseNum(get(row, F.hrs));
        
        // CONTEO MEDIANTE COLUMNA ID (Evita sumar vacíos)
        const idVal = get(row, F.codigo);
        if (idVal !== undefined && String(idVal).trim() !== '') {
            grouped[r].pdv += 1;
        }

        grouped[r].frec += parseIntSafe(get(row, F.frecuencia));
    });
    const despSource = (despRows && despRows.length) ? despRows : baseRows;
    (despSource || []).forEach((row) => {
        const r = String(get(row, F.ruta) ?? '').trim();
        if (!r) return;
        if (!grouped[r]) grouped[r] = { hrsServ: 0, desp: 0, pdv: 0, frec: 0 };
        grouped[r].desp += parseNum(get(row, F.desp));
    });
    return Object.entries(grouped)
        .map(([ruta, v]) => {
            const total = v.hrsServ + v.desp;
            return { ruta, hrsServ: v.hrsServ, desp: v.desp, pdv: v.pdv, frec: v.frec, total, pct: (total / 168) * 100, color: colorMap[ruta] || stringToColor(ruta) };
        })
        .sort((a, b) => b.total - a.total);
};

// Resumen por REGIONAL (para el comparativo).
const computeRegionalSummary = (baseRows, despRows) => {
    const grouped = {};
    const ensure = (reg) => {
        if (!grouped[reg]) grouped[reg] = { hrsServ: 0, desp: 0, pdv: 0, frec: 0, imp: 0, rutas: new Set() };
        return grouped[reg];
    };
    const routeToReg = {};
    (baseRows || []).forEach((row) => {
        const reg = String(get(row, F.regional) ?? '').trim() || 'Sin Regional';
        const g = ensure(reg);
        g.hrsServ += parseNum(get(row, F.hrs));
        
        // CONTEO MEDIANTE COLUMNA ID (Evita sumar vacíos)
        const idVal = get(row, F.codigo);
        if (idVal !== undefined && String(idVal).trim() !== '') {
            g.pdv += 1;
        }
        
        g.frec += parseIntSafe(get(row, F.frecuencia));
        g.imp += parseNum(get(row, F.impTotal)); 
        const r = norm(get(row, F.ruta));
        if (r) { g.rutas.add(r); routeToReg[r] = reg; }
    });
    if (despRows && despRows.length) {
        despRows.forEach((row) => {
            const reg = routeToReg[norm(get(row, F.ruta))] || 'Sin Regional';
            ensure(reg).desp += parseNum(get(row, F.desp));
        });
    } else {
        (baseRows || []).forEach((row) => {
            const reg = String(get(row, F.regional) ?? '').trim() || 'Sin Regional';
            ensure(reg).desp += parseNum(get(row, F.desp));
        });
    }
    return Object.entries(grouped)
        .map(([reg, v]) => {
            const cupos = v.rutas.size || 1;
            const total = v.hrsServ + v.desp;
            return { reg, pdv: v.pdv, frec: v.frec, hrsServ: v.hrsServ, desp: v.desp, imp: v.imp, cupos, pctProm: (total / (cupos * 168)) * 100 };
        })
        .sort((a, b) => b.pdv - a.pdv);
};

// Comparativo de PDV ELIMINADOS por REGIONAL
const computeEliminadosPorRegional = (baseNuevas, eliminados) => {
    const grouped = {};
    const ensure = (reg) => {
        if (!grouped[reg]) grouped[reg] = { cubiertos: 0, eliminados: 0 };
        return grouped[reg];
    };
    (baseNuevas || []).forEach((row) => {
        const idVal = get(row, F.codigo);
        if (idVal !== undefined && String(idVal).trim() !== '') {
            const reg = String(get(row, F.regional) ?? '').trim() || 'Sin Regional';
            ensure(reg).cubiertos += 1;
        }
    });
    (eliminados || []).forEach((row) => {
        const idVal = get(row, F.codigo);
        if (idVal !== undefined && String(idVal).trim() !== '') {
            const reg = String(get(row, F.regional) ?? '').trim() || 'Sin Regional';
            ensure(reg).eliminados += 1;
        }
    });
    return Object.entries(grouped)
        .map(([reg, v]) => {
            const original = v.cubiertos + v.eliminados;
            return {
                reg,
                cubiertos: v.cubiertos,
                eliminados: v.eliminados,
                original,
                pctElim: original > 0 ? (v.eliminados / original) * 100 : 0,
            };
        })
        .sort((a, b) => b.eliminados - a.eliminados);
};

// Clasifica cada hoja del Excel
const classifySheet = (name, rows) => {
    const U = String(name).toUpperCase();
    const keys = rows && rows[0] ? Object.keys(rows[0]).map((k) => k.toUpperCase().trim()) : [];
    const hasKey = (s) => keys.some((k) => k.includes(s));
    const nameHasDesp = U.includes('DEZPLASAMIENTO') || U.includes('DESPLAZAMIENTO');
    const isDespSheet = nameHasDesp && (hasKey('TIEMPO') || keys.length <= 6);
    let side = null;
    if (U.includes('NUEV') || U.includes('ACTUAL') || U.includes('OPTIM')) side = 'nuevo';
    else if (U.includes('VIEJ') || U.includes('ANTERIOR') || U.includes('ANTES')) side = 'anterior';
    if (!side) {
        if (hasKey('REGIONAL VYM') || hasKey('CRUCE') || hasKey('BASE/CORRERIA') || hasKey('CIUDAD BASE CLIENTE')) side = 'nuevo';
        else if (hasKey('SUBCADENA') || hasKey('CANAL') || hasKey('NOMBRE USUARIO') || hasKey('USUARIO SUPERVISOR')) side = 'anterior';
    }
    return { side, isDespSheet };
};

// =============================================================
//  MAPA (Leaflet)
// =============================================================

const MapComponent = ({ data, colorMap }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    useEffect(() => {
        if (!window.L || !mapRef.current || mapInstance.current) return;
        mapInstance.current = window.L.map(mapRef.current, { preferCanvas: true }).setView([4.6097, -74.0817], 5);
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
            .addTo(mapInstance.current);
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, []);
    useEffect(() => {
        if (!mapInstance.current || !window.L) return;
        mapInstance.current.eachLayer((layer) => {
            if (layer instanceof window.L.CircleMarker) mapInstance.current.removeLayer(layer);
        });
        const lats = [], lngs = [];
        (data || []).forEach((row) => {
            const lat = parseCoord(get(row, F.lat));
            const lng = parseCoord(get(row, F.lng));
            if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
            const ruta = String(get(row, F.ruta) ?? '').trim();
            const color = colorMap[ruta] || stringToColor(ruta);
            lats.push(lat); lngs.push(lng);
            window.L.circleMarker([lat, lng], {
                color: '#ffffff', fillColor: color, weight: 1, fillOpacity: 0.9, radius: 5
            })
                .bindPopup(
                    `<b>Ruta:</b> ${ruta || 'N/A'}<br/>` +
                    `<b>PDV:</b> ${get(row, F.pdv) || 'N/A'}<br/>` +
                    `<b>Ciudad:</b> ${get(row, F.ciudad) || 'N/A'}`
                )
                .addTo(mapInstance.current);
        });
        if (lats.length > 0) {
            mapInstance.current.fitBounds(
                [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
                { padding: [40, 40], maxZoom: 14 }
            );
        }
    }, [data, colorMap]);
    return <div ref={mapRef} className="w-full h-full bg-slate-100 z-0 relative" />;
};

// =============================================================
//  BARRA DE FILTROS
// =============================================================

function FilterBar({ title, subtitle, accent = '', baseRows, filters, setFilters }) {
    const fields = ['CIUDAD', 'REGIONAL', 'CADENA', 'RUTA', 'SUPERVISOR', 'ACTIVIDAD'];
    const active = Object.values(filters).filter(Boolean).length;
    const disabled = !baseRows || baseRows.length === 0;
    return (
        <div className={`bg-white rounded-2xl p-4 shadow-sm border border-slate-200 ${accent}`}>
            <div className="flex items-center justify-between mb-3 gap-2">
                <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-800 truncate">{title}</h4>
                    {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
                </div>
                <button
                    onClick={() => setFilters({ CIUDAD: '', REGIONAL: '', CADENA: '', RUTA: '', SUPERVISOR: '', ACTIVIDAD: '' })}
                    disabled={active === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                    Limpiar {active > 0 ? `(${active})` : ''}
                </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                {fields.map((field) => (
                    <div key={field} className="flex flex-col gap-1 min-w-0">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{field}</label>
                        <select
                            value={filters[field]}
                            disabled={disabled}
                            onChange={(e) => setFilters((f) => ({ ...f, [field]: e.target.value }))}
                            className="border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-[#56D400] focus:border-[#56D400] outline-none disabled:bg-slate-50 disabled:text-slate-300"
                        >
                            <option value="">Todas</option>
                            {optionsFor(baseRows, filters, field).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
            </div>
        </div>
    );
}

function HaleonLogo({ h = 24 }) {
    const [ok, setOk] = useState(true);
    if (ok) {
        return <img src="/haleon-logo.png" alt="Haleon" style={{ height: h }} onError={() => setOk(false)} />;
    }
    return (
        <span className="inline-flex items-center gap-2" style={{ height: h }}>
            <svg width={h} height={h} viewBox="0 0 32 32" aria-hidden="true">
                <rect width="32" height="32" rx="7" fill="#56D400" />
                <circle cx="11" cy="12" r="3" fill="#0f172a" />
                <circle cx="21" cy="11" r="3" fill="#0f172a" />
                <circle cx="16" cy="21" r="3" fill="#0f172a" />
                <path d="M11 12 L21 11 L16 21 Z" fill="none" stroke="#0f172a" strokeWidth="1.4" strokeLinejoin="round" opacity="0.45" />
            </svg>
            <span className="font-black tracking-tight text-slate-900" style={{ fontSize: h * 0.72 }}>Haleon</span>
        </span>
    );
}

function Logos({ h = 32 }) {
    return (
        <div className="flex items-center gap-3">
            <HaleonLogo h={h} />
            <span className="w-px bg-slate-300" style={{ height: h * 0.8 }} />
            <img src="/logo-vision.png" alt="Visión & Marketing · Grupo Ohla" style={{ height: h }} className="object-contain" />
        </div>
    );
}

// =============================================================
//  COMPONENTE PRINCIPAL
// =============================================================

function Dashboard({ scriptsLoaded, onHome }) {
    const [status, setStatus] = useState('Esperando archivo Excel...');
    const [isLoading, setIsLoading] = useState(false);
    const [dataState, setDataState] = useState({ bNuevas: [], dNuevas: [], bViejas: [], dViejas: [], eliminados: [] });
    const [autoLoaded, setAutoLoaded] = useState(false);
    
    const emptyFilters = { CIUDAD: '', REGIONAL: '', CADENA: '', RUTA: '', SUPERVISOR: '', ACTIVIDAD: '' };
    
    const [filtersA, setFiltersA] = useState(emptyFilters);
    const [filtersN, setFiltersN] = useState(emptyFilters);
 
    const [coberturaFilter, setCoberturaFilter] = useState('cubiertos'); // 'cubiertos' | 'eliminados' | 'todos'

    // --- Procesa el Excel en crudo (centralizado) ---
    const processExcelBuffer = (buffer) => {
        const wb = window.XLSX.read(buffer, { type: 'array' });
        const raw = { bNuevas: [], dNuevas: [], bViejas: [], dViejas: [], eliminados: [] };
 
        wb.SheetNames.forEach((sn) => {
            let sd = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
            if (!sd.length) return;

            // CORRECCIÓN: Filtramos las filas fantasma vacías y filas de "TOTALES"
            sd = sd.filter(row => {
                const vals = Object.values(row).map(v => String(v).trim().toUpperCase());
                if (vals.some(v => v === 'TOTAL' || v === 'TOTALES' || v.startsWith('TOTAL '))) {
                    return false;
                }
                return get(row, F.pdv) || get(row, F.codigo) || get(row, F.ruta);
            });
            if (!sd.length) return;

            const U = String(sn).toUpperCase();
 
            // Detectar la hoja nueva de eliminados
            if (U.includes('IDS ELIMINADOS') || U.includes('ELIMINADOS')) {
                raw.eliminados = raw.eliminados.concat(sd);
                return;
            }
            const { side, isDespSheet } = classifySheet(sn, sd);
            if (side === 'nuevo') {
                if (isDespSheet) raw.dNuevas = raw.dNuevas.concat(sd);
                else raw.bNuevas = raw.bNuevas.concat(sd);
            } else if (side === 'anterior') {
                if (isDespSheet) raw.dViejas = raw.dViejas.concat(sd);
                else raw.bViejas = raw.bViejas.concat(sd);
            }
        });
 
        setDataState(raw);
        setFiltersA(emptyFilters);
        setFiltersN(emptyFilters);
        setCoberturaFilter('cubiertos');
    };

    // --- Auto-carga del Excel ---
    useEffect(() => {
        if (!scriptsLoaded || autoLoaded) return;
        const fetchExcel = async () => {
            try {
                setIsLoading(true);
                setStatus('⏳ Auto-cargando datos...');
                const fileUrl = '/datos.xlsx';
                const response = await fetch(fileUrl + '?t=' + new Date().getTime(), { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status} (No encontrado)`);
                const arrayBuffer = await response.arrayBuffer();
                processExcelBuffer(arrayBuffer);
                setStatus('✅ ¡Dashboard Auto-Alimentado!');
                setTimeout(() => setStatus('Datos listos'), 3000);
            } catch (err) {
                console.warn('Fallo auto-carga:', err);
                setStatus(`⚠️ Falló: ${err.message}`);
            } finally {
                setIsLoading(false);
                setAutoLoaded(true);
            }
        };
        fetchExcel();
    }, [scriptsLoaded, autoLoaded]);

    // --- lectura del Excel (manual) ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !window.XLSX) return;
        setIsLoading(true);
        setStatus('⏳ Leyendo archivo Excel...');
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                processExcelBuffer(new Uint8Array(evt.target.result));
                setStatus('✅ ¡Dashboard Actualizado!');
                setTimeout(() => setStatus('Datos cargados'), 3000);
            } catch (err) {
                console.error('Error parsing Excel:', err);
                setStatus('❌ Error al procesar el archivo');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // --- paletas de color INDEPENDIENTES por lado ---
    const colorMapA = useMemo(
        () => buildColorMap((dataState.bViejas || []).map((r) => get(r, F.ruta)).filter(Boolean)),
        [dataState]
    );
    const colorMapN = useMemo(
        () => buildColorMap((dataState.bNuevas || []).map((r) => get(r, F.ruta)).filter(Boolean)),
        [dataState]
    );

    // --- datos filtrados de forma INDEPENDIENTE ---
    const filteredA = useMemo(() => filterSide(dataState.bViejas, dataState.dViejas, filtersA), [dataState, filtersA]);
    const filteredN = useMemo(() => filterSide(dataState.bNuevas, dataState.dNuevas, filtersN), [dataState, filtersN]);
 
    // Filtrar los eliminados
    const filteredEliminados = useMemo(() => {
        if (!dataState.eliminados) return [];
        return dataState.eliminados.filter(r => rowMatches(r, filtersN));
    }, [dataState.eliminados, filtersN]);

    // --- KPIs ---
    const kpis = useMemo(() => {
        const bV = filteredA.base, dV = filteredA.desp, bN = filteredN.base, dN = filteredN.desp;
        const despSrcV = dV.length ? dV : bV;
        const despSrcN = dN.length ? dN : bN;
        
        // CONTEO MEDIANTE COLUMNA ID: Filtra y contabiliza solo los registros que tienen un valor válido en ID
        const countPDV = (rows) => rows.filter(r => {
            const id = get(r, F.codigo);
            return id !== undefined && String(id).trim() !== '';
        }).length;

        return {
            pdvViejas: countPDV(bV),
            pdvNuevas: countPDV(bN),
            cuposViejas: new Set(bV.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            cuposNuevas: new Set(bN.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            despViejas: despSrcV.reduce((s, r) => s + parseNum(get(r, F.desp)), 0),
            despNuevas: despSrcN.reduce((s, r) => s + parseNum(get(r, F.desp)), 0),
            hrsViejas: bV.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0),
            hrsNuevas: bN.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0),
            frecViejas: bV.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0),
            frecNuevas: bN.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0),
            impViejas: bV.reduce((s, r) => s + parseNum(get(r, F.impTotal)), 0),
            impNuevas: bN.reduce((s, r) => s + parseNum(get(r, F.impTotal)), 0)
        };
    }, [filteredA, filteredN]);

    const summaryViejas = useMemo(() => computeRouteSummary(filteredA.base, filteredA.desp, colorMapA), [filteredA, colorMapA]);
    const summaryNuevas = useMemo(() => computeRouteSummary(filteredN.base, filteredN.desp, colorMapN), [filteredN, colorMapN]);
    const regionalViejas = useMemo(() => computeRegionalSummary(filteredA.base, filteredA.desp), [filteredA]);
    const regionalNuevas = useMemo(() => computeRegionalSummary(filteredN.base, filteredN.desp), [filteredN]);

    // --- merged regional para exportación paramétrica ---
    const regionalMerged = useMemo(() => {
        const regs = {};
        const getR = (name) => {
            if (!regs[name]) regs[name] = { reg: name, hrsB: 0, hrsA: 0, pdvB: 0, pdvA: 0, frecB: 0, frecA: 0, despB: 0, despA: 0, cuposB: 0, cuposA: 0, impB: 0, impA: 0 };
            return regs[name];
        };
        regionalViejas.forEach(r => {
            const row = getR(r.reg);
            row.hrsB = r.hrsServ; row.pdvB = r.pdv; row.frecB = r.frec; row.despB = r.desp; row.cuposB = r.cupos; row.impB = r.imp;
        });
        regionalNuevas.forEach(r => {
            const row = getR(r.reg);
            row.hrsA = r.hrsServ; row.pdvA = r.pdv; row.frecA = r.frec; row.despA = r.desp; row.cuposA = r.cupos; row.impA = r.imp;
        });
        return Object.values(regs).sort((a,b) => a.reg.localeCompare(b.reg));
    }, [regionalViejas, regionalNuevas]);

    // --- comparativo de PDV eliminados por regional (base nueva vs eliminados) ---
    const eliminadosPorRegional = useMemo(
        () => computeEliminadosPorRegional(filteredN.base, filteredEliminados),
        [filteredN.base, filteredEliminados]
    );

    const totalesElim = useMemo(() => {
        return eliminadosPorRegional.reduce(
            (acc, r) => {
                acc.cubiertos += r.cubiertos;
                acc.eliminados += r.eliminados;
                acc.original += r.original;
                return acc;
            },
            { cubiertos: 0, eliminados: 0, original: 0 }
        );
    }, [eliminadosPorRegional]);

    // --- Exportar a Excel (Parametrizado por Regional) ---
    const handleExportKPI = (kpiId, title) => {
        if (!window.XLSX) {
            alert("La librería de Excel aún no ha cargado.");
            return;
        }
        
        const data = [
            [`Detalle por Regional: ${title.replace(/_/g, ' ')}`],
            [],
            ['Regional', 'Propuesta Anterior', 'Propuesta Optimizada', 'Variación (%)']
        ];

        regionalMerged.forEach(r => {
            let valB = 0, valA = 0;
            if (kpiId === 'hrs') { valB = r.hrsB; valA = r.hrsA; }
            else if (kpiId === 'pdv') { valB = r.pdvB; valA = r.pdvA; }
            else if (kpiId === 'frec') { valB = r.frecB; valA = r.frecA; }
            else if (kpiId === 'desp') { valB = r.despB; valA = r.despA; }
            else if (kpiId === 'cupos') { valB = r.cuposB; valA = r.cuposA; }
            else if (kpiId === 'promDesp') {
                valB = r.cuposB ? r.despB / r.cuposB : 0;
                valA = r.cuposA ? r.despA / r.cuposA : 0;
            }
            else if (kpiId === 'ocup') {
                valB = r.cuposB ? ((r.hrsB + r.despB) / (r.cuposB * 168)) * 100 : 0;
                valA = r.cuposA ? ((r.hrsA + r.despA) / (r.cuposA * 168)) * 100 : 0;
            }
            else if (kpiId === 'pond') {
                valB = Math.round(r.impB * 100); valA = Math.round(r.impA * 100);
            }

            const delta = valB ? ((valA - valB) / valB) * 100 : 0;
            data.push([r.reg, valB, valA, delta]);
        });

        // Totales Globales
        let gB = 0, gA = 0;
        if (kpiId === 'hrs') { gB = kpis.hrsViejas; gA = kpis.hrsNuevas; }
        else if (kpiId === 'pdv') { gB = kpis.pdvViejas; gA = kpis.pdvNuevas; }
        else if (kpiId === 'frec') { gB = kpis.frecViejas; gA = kpis.frecNuevas; }
        else if (kpiId === 'desp') { gB = kpis.despViejas; gA = kpis.despNuevas; }
        else if (kpiId === 'cupos') { gB = kpis.cuposViejas; gA = kpis.cuposNuevas; }
        else if (kpiId === 'promDesp') {
            gB = kpis.cuposViejas ? kpis.despViejas / kpis.cuposViejas : 0;
            gA = kpis.cuposNuevas ? kpis.despNuevas / kpis.cuposNuevas : 0;
        }
        else if (kpiId === 'ocup') {
            gB = kpis.cuposViejas ? ((kpis.hrsViejas + kpis.despViejas) / (kpis.cuposViejas * 168)) * 100 : 0;
            gA = kpis.cuposNuevas ? ((kpis.hrsNuevas + kpis.despNuevas) / (kpis.cuposNuevas * 168)) * 100 : 0;
        }
        else if (kpiId === 'pond') {
            gB = Math.round(kpis.impViejas * 100); gA = Math.round(kpis.impNuevas * 100);
        }

        data.push([]);
        data.push(['TOTAL GENERAL', gB, gA, gB ? ((gA - gB) / gB) * 100 : 0]);

        const wb = window.XLSX.utils.book_new();
        const ws = window.XLSX.utils.aoa_to_sheet(data);
        window.XLSX.utils.book_append_sheet(wb, ws, "KPI Regional");
        window.XLSX.writeFile(wb, `KPI_${title}_Por_Regional.xlsx`);
    };

    const handleExportAll = () => {
        if (!window.XLSX) {
            alert("La librería de Excel aún no ha cargado.");
            return;
        }
        const wb = window.XLSX.utils.book_new();

        // 1. Resumen Global
        const ocupB = kpis.cuposViejas ? ((kpis.hrsViejas + kpis.despViejas) / (kpis.cuposViejas * 168)) * 100 : 0;
        const ocupA = kpis.cuposNuevas ? ((kpis.hrsNuevas + kpis.despNuevas) / (kpis.cuposNuevas * 168)) * 100 : 0;
        const promDespB = kpis.cuposViejas ? kpis.despViejas / kpis.cuposViejas : 0;
        const promDespA = kpis.cuposNuevas ? kpis.despNuevas / kpis.cuposNuevas : 0;

        const kpiData = [
            ['Resumen de Indicadores Clave (TOTALES) - Haleon'],
            [],
            ['Indicador', 'Propuesta Anterior', 'Propuesta Optimizada', 'Variación (%)'],
            ['Total Hrs Servicio (Mes)', kpis.hrsViejas, kpis.hrsNuevas, kpis.hrsViejas ? ((kpis.hrsNuevas - kpis.hrsViejas)/kpis.hrsViejas)*100 : 0],
            ['Total Registros (PDV)', kpis.pdvViejas, kpis.pdvNuevas, kpis.pdvViejas ? ((kpis.pdvNuevas - kpis.pdvViejas)/kpis.pdvViejas)*100 : 0],
            ['Total Frecuencias (Visitas)', kpis.frecViejas, kpis.frecNuevas, kpis.frecViejas ? ((kpis.frecNuevas - kpis.frecViejas)/kpis.frecViejas)*100 : 0],
            ['Tiempo Desplazamiento', kpis.despViejas, kpis.despNuevas, kpis.despViejas ? ((kpis.despNuevas - kpis.despViejas)/kpis.despViejas)*100 : 0],
            ['Cupos Requeridos (Rutas)', kpis.cuposViejas, kpis.cuposNuevas, kpis.cuposViejas ? ((kpis.cuposNuevas - kpis.cuposViejas)/kpis.cuposViejas)*100 : 0],
            ['Prom. Desplaz. x Cupo', promDespB, promDespA, promDespB ? ((promDespA - promDespB)/promDespB)*100 : 0],
            ['Ocupación Laboral Promedio (%)', ocupB, ocupA, ocupB ? ((ocupA - ocupB)/ocupB)*100 : 0],
            ['Ponderado (IMP TOTAL)', Math.round(kpis.impViejas * 100), Math.round(kpis.impNuevas * 100), kpis.impViejas ? ((kpis.impNuevas - kpis.impViejas)/kpis.impViejas)*100 : 0]
        ];
        const wsKpi = window.XLSX.utils.aoa_to_sheet(kpiData);
        window.XLSX.utils.book_append_sheet(wb, wsKpi, "Resumen Global");

        // 2. Resumen DETALLADO por Regional (NUEVA PESTAÑA)
        const dataReg = [
            ['Resumen de Indicadores Clave POR REGIONAL - Haleon'],
            [],
            [
                'Regional',
                'PDV Anterior', 'PDV Optimizado', 'Var PDV %',
                'Hrs Servicio Anterior', 'Hrs Servicio Optimizado', 'Var Hrs %',
                'Frecuencias Anterior', 'Frecuencias Optimizado', 'Var Frec %',
                'Desplazamiento Anterior', 'Desplazamiento Optimizado', 'Var Desp %',
                'Cupos Anterior', 'Cupos Optimizado', 'Var Cupos %',
                'Ocupación Anterior %', 'Ocupación Optimizado %', 'Var Ocupación %',
                'Ponderado Anterior', 'Ponderado Optimizado'
            ]
        ];

        regionalMerged.forEach(r => {
            const d = (a, b) => b ? ((a-b)/b)*100 : 0;
            const ocB = r.cuposB ? ((r.hrsB+r.despB)/(r.cuposB*168))*100 : 0;
            const ocA = r.cuposA ? ((r.hrsA+r.despA)/(r.cuposA*168))*100 : 0;
            dataReg.push([
                r.reg,
                r.pdvB, r.pdvA, d(r.pdvA, r.pdvB),
                r.hrsB, r.hrsA, d(r.hrsA, r.hrsB),
                r.frecB, r.frecA, d(r.frecA, r.frecB),
                r.despB, r.despA, d(r.despA, r.despB),
                r.cuposB, r.cuposA, d(r.cuposA, r.cuposB),
                ocB, ocA, d(ocA, ocB),
                Math.round(r.impB * 100), Math.round(r.impA * 100)
            ]);
        });
        const wsReg = window.XLSX.utils.aoa_to_sheet(dataReg);
        window.XLSX.utils.book_append_sheet(wb, wsReg, "Resumen por Regional");

        // 3. Tablas resumen de rutas
        const formatRuta = (s) => ({
            'Ruta / Usuario': s.ruta, 'PDV': s.pdv, 'Frecuencia': s.frec,
            'Hrs Servicio': s.hrsServ, 'Hrs Desplazamiento': s.desp,
            'Total Hrs': s.total, 'Ocupación (168h) %': s.pct
        });
        const wsRutasNuevas = window.XLSX.utils.json_to_sheet(summaryNuevas.map(formatRuta));
        window.XLSX.utils.book_append_sheet(wb, wsRutasNuevas, "Rutas Optimizada");

        const wsRutasViejas = window.XLSX.utils.json_to_sheet(summaryViejas.map(formatRuta));
        window.XLSX.utils.book_append_sheet(wb, wsRutasViejas, "Rutas Anterior");

        window.XLSX.writeFile(wb, "Reporte_General_Dashboard.xlsx");
    };

    // --- fila de tabla de resumen por ruta (compartida) ---
    const RouteRow = ({ s }) => {
        const isGreen = s.pct >= 98 && s.pct <= 101;
        const isRed = s.pct > 101;
        const barColor = isRed ? 'bg-red-500' : isGreen ? 'bg-[#56D400]' : 'bg-amber-400';
        return (
            <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-sm font-medium text-slate-800">
                    <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="truncate">{s.ruta}</span>
                    </span>
                </td>
                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.pdv.toLocaleString()}</td>
                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.frec.toLocaleString()}</td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.hrsServ.toFixed(1)}h</td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.desp.toFixed(1)}h</td>
                <td className="p-3 text-sm font-bold text-slate-800 whitespace-nowrap">{s.total.toFixed(1)}h</td>
                <td className="p-3 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden shrink-0">
                            <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(s.pct, 100)}%` }} />
                        </div>
                        <span className={isRed ? 'text-red-600 font-bold' : 'text-slate-700'}>
                            {s.pct.toFixed(1)}%{isRed ? ' ⚠' : ''}
                        </span>
                    </div>
                </td>
            </tr>
        );
    };

    const RouteTableHead = () => (
        <thead className="sticky top-0 z-20">
            <tr className="text-xs uppercase text-slate-500">
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200">Ruta / Usuario</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">PDV</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">Frec.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Serv.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Desp.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Total</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">% Ocup (168h)</th>
            </tr>
        </thead>
    );

    const emptyRow = (cols, msg) => (
        <tr><td colSpan={cols} className="text-center text-slate-400 py-8">{msg}</td></tr>
    );

    // --- fila / encabezado del comparativo por REGIONAL ---
    const RegionalRow = ({ s }) => {
        const over = s.pctProm > 100;
        const warn = s.pctProm > 85 && s.pctProm <= 100;
        const barColor = over ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-[#56D400]';
        return (
            <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-sm font-medium text-slate-800">{s.reg}</td>
                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.cupos.toLocaleString()}</td>
                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.pdv.toLocaleString()}</td>
                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.frec.toLocaleString()}</td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.hrsServ.toFixed(1)}h</td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.desp.toFixed(1)}h</td>
                <td className="p-3 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden shrink-0">
                            <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(s.pctProm, 100)}%` }} />
                        </div>
                        <span className={over ? 'text-red-600 font-bold' : 'text-slate-700'}>
                            {s.pctProm.toFixed(1)}%{over ? ' ⚠' : ''}
                        </span>
                    </div>
                </td>
            </tr>
        );
    };

    const RegionalTableHead = () => (
        <thead className="sticky top-0 z-20">
            <tr className="text-xs uppercase text-slate-500">
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200">Regional</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">Cupos</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">PDV</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">Frec.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Serv.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Desp.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">% Ocup. Prom.</th>
            </tr>
        </thead>
    );

    // Preparar filas para la tabla del directorio general
    const rowsToRender = useMemo(() => {
        let rows = [];
        if (coberturaFilter === 'cubiertos') {
            rows = (filteredN.base || []).map(r => ({ ...r, _status: 'cubierto' }));
        } else if (coberturaFilter === 'eliminados') {
            rows = (filteredEliminados || []).map(r => ({ ...r, _status: 'eliminado' }));
        } else {
            rows = [
                ...(filteredN.base || []).map(r => ({ ...r, _status: 'cubierto' })),
                ...(filteredEliminados || []).map(r => ({ ...r, _status: 'eliminado' }))
            ];
        }
        return rows;
    }, [filteredN.base, filteredEliminados, coberturaFilter]);

    // --- directorio general ---
    const renderTableGeneral = () => {
        if (rowsToRender.length === 0) return emptyRow(9, 'No hay datos para mostrar con el filtro actual...');
 
        return rowsToRender.slice(0, 500).map((row, idx) => {
            const rawImp = get(row, F.impTotal);
            const impFormatted = rawImp !== undefined && rawImp !== ''
                ? new Intl.NumberFormat('es-CO', { style: 'percent', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(parseNum(rawImp))
                : '-';
            const decil = String(get(row, F.decil) ?? '-');
            return (
                <tr key={idx} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${row._status === 'eliminado' ? 'bg-red-50/40' : ''}`}>
                    <td className="p-3 text-sm text-slate-600">{String(get(row, F.codigo) ?? '-')}</td>
                    <td className="p-3 text-sm font-medium text-slate-800">{String(get(row, F.cadena) ?? '-')}</td>
                    <td className="p-3 text-sm text-slate-600 truncate max-w-xs">{String(get(row, F.pdv) ?? '-')}</td>
                    <td className="p-3 text-sm text-slate-600">{String(get(row, F.ciudad) ?? '-')}</td>
                    <td className="p-3 text-sm">
                        <span className="flex items-center gap-2">
                            {row._status === 'cubierto' ? (
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorMapN[String(get(row, F.ruta) ?? '').trim()] || stringToColor(get(row, F.ruta)) }} />
                            ) : (
                                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-red-500" title="Eliminado/No Cubierto" />
                            )}
                            <span className={row._status === 'eliminado' ? 'text-red-700 font-medium' : ''}>
                                {String(get(row, F.ruta) ?? 'Sin Asignar')}
                            </span>
                        </span>
                    </td>
                    <td className="p-3 text-sm text-center text-slate-600">{String(get(row, F.frecuencia) ?? '-')}</td>
                    <td className="p-3 text-sm font-semibold text-[#56D400]">{parseNum(get(row, F.hrs)).toFixed(2)}h</td>
                    <td className="p-3 text-sm text-center font-medium text-slate-700">{decil}</td>
                    <td className="p-3 text-sm text-right font-medium text-slate-700">{impFormatted}</td>
                </tr>
            );
        });
    };

    return (
        <div className="min-h-screen bg-slate-100 font-sans p-6 overflow-x-hidden flex justify-center">
            <div className="w-full max-w-[1800px] flex flex-col gap-6">
                {/* HEADER */}
                <header className="bg-white rounded-2xl p-6 shadow-sm flex flex-wrap gap-4 justify-between items-center border border-slate-200">
                    <div className="flex flex-col items-start">
                        <button onClick={onHome} className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors mb-1">
                            ← Portada
                        </button>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Comparativa de Rutas: Antes vs. Después</h1>
                        <p className="text-slate-500 mt-1">Análisis de eficiencia, ocupación laboral y agrupación geoespacial.</p>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col items-center">
                            <div className="flex items-center gap-2">
                                <label className={`cursor-pointer px-6 py-3 rounded-lg font-bold text-sm shadow-lg transition-all
                                    ${!scriptsLoaded || isLoading ? 'bg-yellow-400 text-white cursor-not-allowed' : 'bg-[#56D400] text-black hover:scale-105 hover:shadow-xl'}`}>
                                    {isLoading ? '⏳ Procesando...' : (!scriptsLoaded ? '⏳ Cargando entorno...' : '📥 Cargar Excel (.xlsx)')}
                                    <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={!scriptsLoaded || isLoading} />
                                </label>
                                <button
                                    onClick={() => setAutoLoaded(false)}
                                    disabled={!scriptsLoaded || isLoading}
                                    title="Volver a leer /datos.xlsx del servidor"
                                    className="px-4 py-3 rounded-lg font-bold text-sm border border-slate-300 text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    🔄 Recargar datos
                                </button>
                            </div>
                            <span className="text-xs text-slate-500 mt-2 font-medium">{status}</span>
                        </div>
                        <Logos h={30} />
                    </div>
                </header>

                {/* HEADER KPIs + BOTON EXCEL GENERAL */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mt-2 mb-1">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Indicadores Clave</h2>
                        <p className="text-sm text-slate-500 mt-1">Pasa el ratón sobre cada KPI para descargarlo detallado por <span className="font-bold text-slate-700">REGIONAL</span>.</p>
                    </div>
                    <button
                        onClick={handleExportAll}
                        disabled={!scriptsLoaded || isLoading}
                        className="px-6 py-3 rounded-xl bg-slate-800 text-white font-extrabold text-sm shadow-lg hover:bg-slate-700 hover:scale-105 hover:shadow-xl transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        Descargar Todo (General)
                    </button>
                </div>

                {/* KPIS (comparan cada lado según su propio filtro) */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 xl:gap-4">
                    <KPICard title="Total Hrs Servicio (Mes)" valB={kpis.hrsViejas} valA={kpis.hrsNuevas} format="hrs" onDownload={() => handleExportKPI("hrs", "Total_Hrs_Servicio")} />
                    <KPICard title="Total Registros (PDV)" valB={kpis.pdvViejas} valA={kpis.pdvNuevas} format="num" onDownload={() => handleExportKPI("pdv", "Total_Registros")} />
                    <KPICard title="Total Frecuencias (Visitas)" valB={kpis.frecViejas} valA={kpis.frecNuevas} format="num" onDownload={() => handleExportKPI("frec", "Frecuencias")} />
                    <KPICard title="Tiempo Desplazamiento" valB={kpis.despViejas} valA={kpis.despNuevas} format="hrs" inverse onDownload={() => handleExportKPI("desp", "Tiempo_Desplazamiento")} />
                    <KPICard title="Cupos Requeridos (Rutas)" valB={kpis.cuposViejas} valA={kpis.cuposNuevas} format="num" inverse onDownload={() => handleExportKPI("cupos", "Cupos_Requeridos")} />
                    <KPICard title="Prom. Desplaz. x Cupo"
                        valB={kpis.cuposViejas ? kpis.despViejas / kpis.cuposViejas : 0}
                        valA={kpis.cuposNuevas ? kpis.despNuevas / kpis.cuposNuevas : 0}
                        format="hrs" inverse onDownload={() => handleExportKPI("promDesp", "Prom_Desplaz_x_Cupo")} />
                    <KPICard title="Ocupación Laboral Promedio"
                        valB={kpis.cuposViejas ? ((kpis.hrsViejas + kpis.despViejas) / (kpis.cuposViejas * 168)) * 100 : 0}
                        valA={kpis.cuposNuevas ? ((kpis.hrsNuevas + kpis.despNuevas) / (kpis.cuposNuevas * 168)) * 100 : 0}
                        format="pct" inverse onDownload={() => handleExportKPI("ocup", "Ocupacion_Promedio")} />
                    <KPICard title="Ponderado (IMP TOTAL)" 
                        valB={kpis.impViejas * 100} 
                        valA={kpis.impNuevas * 100} 
                        format="pct-int" onDownload={() => handleExportKPI("pond", "Ponderado")} />
                </div>

                {/* DOS COLUMNAS INDEPENDIENTES */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* ===== LADO IZQUIERDO: ANTERIOR ===== */}
                    <div className="flex flex-col gap-4">
                        <FilterBar
                            title="Filtros · Propuesta Anterior"
                            subtitle="Aplican solo a esta propuesta"
                            baseRows={dataState.bViejas}
                            filters={filtersA}
                            setFilters={setFiltersA}
                        />
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Anterior <span className="text-slate-400 font-normal">(No Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filteredA.base} colorMap={colorMapA} />
                                    : <div className="w-full h-full flex items-center justify-center text-slate-400">Cargando mapa...</div>}
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[420px]">
                            <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                                <h3 className="text-lg font-bold text-slate-800">Detalle por Ruta (Anterior)</h3>
                            </div>
                            <div className="overflow-y-auto flex-1 px-5 pb-4">
                                <table className="w-full text-left">
                                    <RouteTableHead />
                                    <tbody>
                                        {summaryViejas.length === 0 ? emptyRow(7, 'Sin datos') : summaryViejas.map((s) => <RouteRow key={s.ruta} s={s} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* ===== LADO DERECHO: OPTIMIZADA ===== */}
                    <div className="flex flex-col gap-4">
                        <FilterBar
                            title="Filtros · Propuesta Optimizada"
                            subtitle="Aplican solo a esta propuesta (También afectan a Eliminados)"
                            accent="border-t-4 border-t-[#56D400]"
                            baseRows={dataState.bNuevas}
                            filters={filtersN}
                            setFilters={setFiltersN}
                        />
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col border-t-4 border-t-[#56D400]">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Actual <span className="text-[#56D400]">(Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filteredN.base} colorMap={colorMapN} />
                                    : <div className="w-full h-full flex items-center justify-center text-slate-400">Cargando mapa...</div>}
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[420px]">
                            <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                                <h3 className="text-lg font-bold text-slate-800">Detalle por Ruta (Optimizado)</h3>
                            </div>
                            <div className="overflow-y-auto flex-1 px-5 pb-4">
                                <table className="w-full text-left">
                                    <RouteTableHead />
                                    <tbody>
                                        {summaryNuevas.length === 0 ? emptyRow(7, 'Sin datos') : summaryNuevas.map((s) => <RouteRow key={s.ruta} s={s} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* COMPARATIVO POR REGIONAL */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[460px]">
                        <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                            <h3 className="text-lg font-bold text-slate-800">Comparativo por Regional <span className="text-slate-400 font-normal">(Anterior)</span></h3>
                        </div>
                        <div className="overflow-y-auto flex-1 px-5 pb-4">
                            <table className="w-full text-left">
                                <RegionalTableHead />
                                <tbody>
                                    {regionalViejas.length === 0 ? emptyRow(7, 'Sin datos') : regionalViejas.map((s) => <RegionalRow key={s.reg} s={s} />)}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[460px] border-t-4 border-t-[#56D400]">
                        <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                            <h3 className="text-lg font-bold text-slate-800">Comparativo por Regional <span className="text-[#56D400]">(Optimizado)</span></h3>
                        </div>
                        <div className="overflow-y-auto flex-1 px-5 pb-4">
                            <table className="w-full text-left">
                                <RegionalTableHead />
                                <tbody>
                                    {regionalNuevas.length === 0 ? emptyRow(7, 'Sin datos') : regionalNuevas.map((s) => <RegionalRow key={s.reg} s={s} />)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* PDV ELIMINADOS POR REGIONAL */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[560px] border-t-4 border-t-red-400">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                        <h3 className="text-xl font-bold text-slate-800">Puntos de Venta Eliminados por Regional</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Comparación de la base optimizada (cubiertos) vs. los PDV eliminados, agrupados por <span className="font-semibold text-slate-700">REGIONAL VYM</span>. Responde a los filtros de la propuesta optimizada.
                        </p>
                    </div>
                    <div className="overflow-y-auto flex-1 px-6 pb-4">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 z-20">
                                <tr className="text-xs uppercase text-slate-500">
                                    <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200">Regional</th>
                                    <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">PDV Cubiertos</th>
                                    <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">PDV Eliminados</th>
                                    <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 text-center whitespace-nowrap">Total Original</th>
                                    <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">% Eliminado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {eliminadosPorRegional.length === 0
                                    ? emptyRow(5, 'No hay hoja de eliminados cargada o no hay datos con el filtro actual...')
                                    : eliminadosPorRegional.map((s) => {
                                        const high = s.pctElim > 30;
                                        const mid = s.pctElim > 15 && s.pctElim <= 30;
                                        const barColor = high ? 'bg-red-500' : mid ? 'bg-amber-400' : 'bg-[#56D400]';
                                        return (
                                            <tr key={s.reg} className="border-b border-slate-100 hover:bg-slate-50">
                                                <td className="p-3 text-sm font-medium text-slate-800">{s.reg}</td>
                                                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.cubiertos.toLocaleString()}</td>
                                                <td className="p-3 text-sm text-center font-bold text-red-600 whitespace-nowrap">{s.eliminados.toLocaleString()}</td>
                                                <td className="p-3 text-sm text-center text-slate-600 whitespace-nowrap">{s.original.toLocaleString()}</td>
                                                <td className="p-3 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden shrink-0">
                                                            <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(s.pctElim, 100)}%` }} />
                                                        </div>
                                                        <span className={high ? 'text-red-600 font-bold' : 'text-slate-700'}>{s.pctElim.toFixed(1)}%</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                            {eliminadosPorRegional.length > 0 && (
                                <tfoot className="sticky bottom-0 z-20">
                                    <tr className="bg-slate-50 font-bold text-slate-800">
                                        <td className="p-3 text-sm border-t-2 border-slate-300">TOTAL</td>
                                        <td className="p-3 text-sm text-center border-t-2 border-slate-300 whitespace-nowrap">{totalesElim.cubiertos.toLocaleString()}</td>
                                        <td className="p-3 text-sm text-center text-red-600 border-t-2 border-slate-300 whitespace-nowrap">{totalesElim.eliminados.toLocaleString()}</td>
                                        <td className="p-3 text-sm text-center border-t-2 border-slate-300 whitespace-nowrap">{totalesElim.original.toLocaleString()}</td>
                                        <td className="p-3 text-sm border-t-2 border-slate-300 whitespace-nowrap">
                                            {totalesElim.original > 0 ? ((totalesElim.eliminados / totalesElim.original) * 100).toFixed(1) : '0.0'}%
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>

                {/* DIRECTORIO GENERAL */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[620px]">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0 flex flex-col md:flex-row gap-4 justify-between items-start md:items-end">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Directorio de Puntos de Venta (Rutas Nuevas)</h3>
                            <div className="flex items-center gap-3 mt-3">
                                <label className="text-sm font-semibold text-slate-500">Estado de Cobertura:</label>
                                <select
                                    value={coberturaFilter}
                                    onChange={(e) => setCoberturaFilter(e.target.value)}
                                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[#56D400] focus:border-[#56D400] outline-none"
                                >
                                    <option value="cubiertos">Cubiertos</option>
                                    <option value="eliminados">No Cubiertos (Eliminados)</option>
                                    <option value="todos">Todos</option>
                                </select>
                            </div>
                        </div>
                        <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
                            Mostrando {Math.min(500, rowsToRender.length)} de {rowsToRender.length}
                        </span>
                    </div>
                    <div className="overflow-y-auto flex-1 px-6 pb-4">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 z-20">
                                <tr className="text-xs uppercase text-slate-500">
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">ID PDV</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Cadena</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Nombre Punto de Venta</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Ciudad</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Ruta Asignada</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200 text-center">Frecuencia</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Hrs Servicio</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200 text-center">Decil</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200 text-right">Imp Total</th>
                                </tr>
                            </thead>
                            <tbody>{renderTableGeneral()}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

// =============================================================
//  TARJETA KPI
// =============================================================
function KPICard({ title, valB, valA, format = 'num', inverse = false, onDownload }) {
    const formatVal = (v) => {
        if (typeof v !== 'number' || isNaN(v)) return '0';
        if (format === 'num') return Math.round(v).toLocaleString();
        if (format === 'hrs') return v.toFixed(1) + 'h';
        if (format === 'pct') return v.toFixed(1) + '%';
        if (format === 'pct-int') return Math.round(v) + '%';
        return String(v);
    };
    let deltaStr = '-', isGood = false, isNeutral = true;
    if (valB > 0) {
        const delta = ((valA - valB) / valB) * 100;
        deltaStr = (delta > 0 ? '+' : '') + delta.toFixed(1) + '%';
        isNeutral = Math.abs(delta) < 0.5;
        isGood = inverse ? delta < 0 : delta > 0;
    }
    return (
        <div className="bg-white rounded-2xl p-4 xl:p-5 shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition-shadow overflow-hidden w-full relative group">
            <div className="flex justify-between items-start mb-2 gap-2">
                <h4 className="text-[10px] xl:text-xs font-bold text-slate-500 uppercase tracking-wide min-h-[2.5rem] leading-tight line-clamp-2 flex-1">{title}</h4>
                {onDownload && (
                    <button onClick={onDownload} title={`Descargar detalle por Regional de: ${title}`} className="p-1.5 rounded-lg text-slate-400 hover:text-[#56D400] hover:bg-[#56D400]/10 opacity-0 group-hover:opacity-100 transition-all shrink-0 -mt-1 -mr-1">
                        <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </button>
                )}
            </div>
            <div className="flex justify-between items-end gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs xl:text-sm font-semibold text-slate-400 line-through mb-1 truncate">{formatVal(valB)}</span>
                    <span className="text-xl sm:text-2xl xl:text-3xl font-black text-slate-800 tracking-tight truncate">{formatVal(valA)}</span>
                </div>
                <div className={`px-2 py-1 rounded-full text-[10px] xl:text-xs font-bold whitespace-nowrap shrink-0
                    ${isNeutral ? 'bg-slate-100 text-slate-500' : (isGood ? 'bg-[#eaffe0] text-[#3f9b00]' : 'bg-red-100 text-red-600')}`}>
                    {deltaStr}
                </div>
            </div>
        </div>
    );
}

// =============================================================
//  PORTADA / PANTALLA DE BIENVENIDA (con mapa de Colombia)
// =============================================================
const PORTADA_CIUDADES = [
    { n: 'Bogotá', lat: 4.7110, lng: -74.0721, hub: true },
    { n: 'Medellín', lat: 6.2442, lng: -75.5812, hub: true },
    { n: 'Cali', lat: 3.4516, lng: -76.5320, hub: true },
    { n: 'Barranquilla', lat: 10.9685, lng: -74.7813, hub: true },
    { n: 'Cartagena', lat: 10.3910, lng: -75.4794 },
    { n: 'Bucaramanga', lat: 7.1193, lng: -73.1227 },
    { n: 'Cúcuta', lat: 7.8939, lng: -72.5078 },
    { n: 'Ibagué', lat: 4.4389, lng: -75.2322 },
    { n: 'Armenia', lat: 4.5339, lng: -75.6811 },
    { n: 'Pereira', lat: 4.8133, lng: -75.6961 },
    { n: 'Manizales', lat: 5.0703, lng: -75.5138 },
    { n: 'Santa Marta', lat: 11.2408, lng: -74.1990 },
    { n: 'Villavicencio', lat: 4.1420, lng: -73.6266 },
    { n: 'Neiva', lat: 2.9273, lng: -75.2819 },
    { n: 'Pasto', lat: 1.2136, lng: -77.2811 },
];
// Rutas decorativas (secuencias de índices de ciudad)
const PORTADA_RUTAS = [
    [0, 7, 8, 9, 10, 2, 14],
    [0, 5, 6],
    [1, 3, 4, 11],
    [0, 1],
    [0, 12, 13],
];

function PortadaMap() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    useEffect(() => {
        if (!window.L || !mapRef.current || mapInstance.current) return;
        const map = window.L.map(mapRef.current, {
            zoomControl: false, attributionControl: false, dragging: false,
            scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
            keyboard: false, touchZoom: false, zoomSnap: 0.25,
        });
        mapInstance.current = map;
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
        PORTADA_RUTAS.forEach((seq) => {
            const pts = seq.map((i) => [PORTADA_CIUDADES[i].lat, PORTADA_CIUDADES[i].lng]);
            window.L.polyline(pts, { color: '#3fa000', weight: 2.5, opacity: 0.8, dashArray: '4 9', lineCap: 'round', className: 'pf-route', interactive: false }).addTo(map);
        });
        PORTADA_CIUDADES.forEach((c) => {
            if (c.hub) {
                window.L.circleMarker([c.lat, c.lng], { radius: 13, stroke: false, fillColor: '#56D400', fillOpacity: 0.22, className: 'pf-halo', interactive: false }).addTo(map);
            }
            window.L.circleMarker([c.lat, c.lng], { radius: c.hub ? 5 : 3, color: '#0f172a', weight: c.hub ? 1.5 : 1, fillColor: '#56D400', fillOpacity: 1, interactive: false }).addTo(map);
            if (c.hub) {
                window.L.marker([c.lat, c.lng], { interactive: false, icon: window.L.divIcon({ className: 'pf-label', html: `<span>${c.n}</span>`, iconSize: [0, 0] }) }).addTo(map);
            }
        });
        const bounds = window.L.latLngBounds(PORTADA_CIUDADES.map((c) => [c.lat, c.lng]));
        const fit = () => { map.invalidateSize(); map.fitBounds(bounds, { padding: [60, 60] }); };
        fit();
        window.addEventListener('resize', fit);
        map._pfFit = fit;
        return () => {
            window.removeEventListener('resize', map._pfFit);
            map.remove();
            mapInstance.current = null;
        };
    }, []);
    return <div ref={mapRef} className="absolute inset-0 w-full h-full" style={{ background: '#eef2f7' }} />;
}

function Portada({ onEnter, scriptsLoaded }) {
    return (
        <div className="min-h-screen relative overflow-hidden bg-slate-100 font-sans">
            <style>{`
                @keyframes pf { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
                @keyframes pfRoute { to { stroke-dashoffset: -52; } }
                @keyframes pfHalo { 0%,100% { opacity: .15; } 50% { opacity: .45; } }
                .pf-route { animation: pfRoute 1.6s linear infinite; }
                .pf-halo { animation: pfHalo 3s ease-in-out infinite; }
                .pf-label span {
                    position: absolute; transform: translate(10px, -9px);
                    font-size: 11px; font-weight: 700; letter-spacing: .02em;
                    color: rgba(15,23,42,0.9); white-space: nowrap;
                    text-shadow: 0 1px 3px rgba(255,255,255,0.95); pointer-events: none;
                }
                .leaflet-container { background: #eef2f7 !important; }
            `}</style>
            {/* MAPA DE FONDO */}
            {scriptsLoaded ? <PortadaMap /> : <div className="absolute inset-0" style={{ background: '#eef2f7' }} />}
            {/* velos claros para legibilidad */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(248,250,252,0.97) 0%, rgba(248,250,252,0.88) 36%, rgba(248,250,252,0.45) 68%, rgba(248,250,252,0.12) 100%)' }} />
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(248,250,252,0.85) 0%, transparent 20%, transparent 72%, rgba(248,250,252,0.92) 100%)' }} />
            <div className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full blur-3xl pointer-events-none" style={{ background: 'rgba(86,212,0,0.14)' }} />
            {/* CONTENIDO */}
            <div className="relative z-10 min-h-screen flex flex-col">
                {/* top bar */}
                <div className="flex items-center justify-between px-6 md:px-12 py-6" style={{ animation: 'pf .5s ease-out both' }}>
                    <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-slate-200">
                        <Logos h={22} />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-[#56D400]" style={{ boxShadow: '0 0 10px #56D400' }} />
                        {scriptsLoaded ? 'Entorno listo · datos en vivo' : 'Preparando entorno…'}
                    </div>
                </div>
                {/* hero */}
                <div className="flex-1 flex items-center px-6 md:px-12">
                    <div className="max-w-2xl">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold mb-6"
                            style={{ background: 'rgba(86,212,0,0.12)', borderColor: 'rgba(86,212,0,0.45)', color: '#2f8a00', animation: 'pf .7s ease-out both' }}>
                            <span className="w-1.5 h-1.5 rounded-full bg-[#56D400]" />
                            OPTIMIZACIÓN DE RUTAS COMERCIALES
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tight leading-[1.05]" style={{ animation: 'pf .8s ease-out both' }}>
                            Comparativa de Rutas
                            <span className="block text-[#3fa000]">Antes <span className="text-slate-400 font-bold">vs.</span> Después</span>
                        </h1>
                        <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed max-w-xl" style={{ animation: 'pf .95s ease-out both' }}>
                            Analiza, filtra y compara dos propuestas de cobertura comercial a nivel nacional:
                            eficiencia, ocupación laboral y distribución geoespacial de cada usuario.
                        </p>
                        <div className="mt-7 flex flex-wrap gap-3" style={{ animation: 'pf 1.1s ease-out both' }}>
                            {['Filtros independientes', 'Mapas por usuario', 'KPIs comparativos'].map((t) => (
                                <span key={t} className="px-4 py-2 rounded-full text-sm font-medium text-slate-700 bg-white border border-slate-200 shadow-sm">
                                    {t}
                                </span>
                            ))}
                        </div>
                        <div className="mt-10 flex flex-wrap items-center gap-4" style={{ animation: 'pf 1.25s ease-out both' }}>
                            <button
                                onClick={onEnter}
                                className="px-9 py-4 rounded-xl bg-[#56D400] text-black font-extrabold text-lg shadow-[0_10px_40px_-10px_rgba(86,212,0,0.7)] hover:scale-105 hover:shadow-[0_16px_55px_-10px_rgba(86,212,0,0.95)] transition-all duration-200"
                            >
                                Entrar al Dashboard →
                            </button>
                            <span className="text-sm text-slate-500">Cobertura nacional · Colombia</span>
                        </div>
                    </div>
                </div>
                {/* footer mini-stats */}
                <div className="px-6 md:px-12 py-6 border-t border-slate-200" style={{ animation: 'pf 1.4s ease-out both' }}>
                    <div className="flex flex-wrap items-end gap-8 md:gap-12">
                        {[['2', 'Propuestas comparadas'], ['Antes / Después', 'Escenarios'], ['Tiempo real', 'Filtros y mapas']].map(([big, small]) => (
                            <div key={small}>
                                <div className="text-xl md:text-2xl font-black text-slate-900">{big}</div>
                                <div className="text-xs text-slate-500 mt-0.5">{small}</div>
                            </div>
                        ))}
                        <div className="ml-auto text-[11px] text-slate-400">Haleon · Análisis de Rutas</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// =============================================================
//  RAÍZ
// =============================================================
export default function App() {
    const [view, setView] = useState('portada');
    const [scriptsLoaded, setScriptsLoaded] = useState(false);
    useEffect(() => {
        const loadScript = (src) => new Promise((resolve) => {
            if ([...document.scripts].some((s) => s.src === src)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; document.head.appendChild(s);
        });
        if (!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css'; link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        Promise.all([
            loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
            loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
        ]).then(() => setScriptsLoaded(true));
    }, []);
    if (view === 'portada') {
        return <Portada onEnter={() => setView('dashboard')} scriptsLoaded={scriptsLoaded} />;
    }
    return <Dashboard scriptsLoaded={scriptsLoaded} onHome={() => setView('portada')} />;
}
