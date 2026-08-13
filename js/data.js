/* Default seed data — used only the first time the app runs on a device
   (or after "Borrar todos los datos"). Editing after that happens through
   the "Editar plan" screen in the app itself, not this file. */

const DEFAULT_PHASE_TU = {
  1: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  2: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  3: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  4: { r: '1–2 RIR', t: '+1 serie en el primer ejercicio de Superior A y Superior B.' },
  5: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  6: { r: '0–1 RIR', t: '+1 serie en press de hombros y press inclinado.' },
  7: { r: '0–1 RIR', t: 'La semana más dura. Última serie de cada máquina al fallo.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

const DEFAULT_PHASE_PAREJA = {
  1: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  2: { r: '2–3 RIR', t: 'Ajustando pesos. Deja repeticiones en la recámara.' },
  3: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  4: { r: '1–2 RIR', t: '+1 serie en hip thrust y en jalón al pecho.' },
  5: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena.' },
  6: { r: '0–1 RIR', t: '+1 serie en prensa. Lleva el trabajo de glúteo al fallo.' },
  7: { r: '0–1 RIR', t: 'La semana más dura. Última serie de cada máquina al fallo.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

const DEFAULT_DAYS_TU = [
  { name: 'Superior A', sub: 'Empuje', pair: 'Estaciones 1-3 compartidas: alternad series mientras la otra descansa. Os separais en la contractora: ella pasa al hip thrust y tu terminas pecho y hombro.', ex: [
    { id: 'chestpress', share: 1, n: 'Press de pecho en máquina', alt: 'o press de banca con barra', sets: 4, add: 4, reps: '6–10', rest: 150 },
    { id: 'shoulderpress', share: 1, n: 'Press de hombros en máquina', alt: 'o press militar con mancuernas', sets: 4, add: 6, reps: '8–12', rest: 150 },
    { id: 'cablerow', share: 1, n: 'Remo sentado en polea', alt: 'o remo con apoyo pectoral', sets: 3, reps: '10–15', rest: 120 },
    { id: 'pecdeck', n: 'Contractora / aperturas en polea', alt: 'o aperturas con mancuernas', sets: 4, reps: '12–15', rest: 90, cue: 'Estirar del todo atrás — sin recortar el recorrido' },
    { id: 'lat1', n: 'Elevaciones laterales en polea', alt: 'o con mancuernas', sets: 3, reps: '12–20', rest: 0, ss: 1 },
    { id: 'pushdown', n: 'Extensiones de tríceps en polea', alt: 'o press francés', sets: 3, reps: '12–15', rest: 90, ss: 1 },
    { id: 'lat1x', n: 'Elevaciones laterales en polea', alt: 'serie extra — mismo peso, suelta', sets: 1, reps: '12–20', rest: 60 },
  ]},
  { name: 'Pierna + Brazo', sub: 'Pierna', pair: 'Estaciones 1-3 compartidas, mas la superserie de brazo. Ella anade zancadas y abductores mientras tu haces jalon y laterales.', ex: [
    { id: 'hacksquat', share: 1, n: 'Sentadilla hack', alt: 'o pendular / sentadilla con barra', sets: 3, reps: '8–12', rest: 150 },
    { id: 'rdl', share: 1, n: 'Peso muerto rumano en multipower', alt: 'o hiperextensiones a 45°', sets: 3, reps: '8–12', rest: 150 },
    { id: 'legcurl', share: 1, n: 'Curl femoral sentado', alt: '', sets: 2, reps: '12–15', rest: 90 },
    { id: 'pulldown_n', n: 'Jalón agarre neutro', alt: 'o dominadas asistidas', sets: 3, reps: '10–12', rest: 120 },
    { id: 'inclinecurl', share: 1, n: 'Curl inclinado en polea', alt: 'o curl inclinado con mancuernas', sets: 3, reps: '10–15', rest: 0, ss: 1, cue: 'Codos por detrás del torso' },
    { id: 'ohext', share: 1, n: 'Extensión de tríceps sobre la cabeza', alt: 'en polea o con mancuerna', sets: 3, reps: '12–15', rest: 90, ss: 1 },
    { id: 'lat2', n: 'Elevaciones laterales en polea', alt: 'o con mancuernas', sets: 4, reps: '12–20', rest: 60 },
  ]},
  { name: 'Superior B', sub: 'Tirón', pair: 'Cinco de seis estaciones compartidas. Ella hace cuatro series de prensa y tu tres: aprovecha para descansar mientras termina.', ex: [
    { id: 'pulldown_w', share: 1, n: 'Jalón al pecho, agarre ancho', alt: 'o dominadas', sets: 4, add: 4, reps: '8–12', rest: 150 },
    { id: 'inclinepress', share: 1, n: 'Press inclinado en máquina', alt: 'o press inclinado con mancuernas', sets: 4, add: 6, reps: '8–12', rest: 150 },
    { id: 'csrow', share: 1, n: 'Remo en máquina con apoyo pectoral', alt: 'o remo con barra', sets: 3, reps: '10–15', rest: 120 },
    { id: 'legpress', share: 1, n: 'Prensa de piernas', alt: '', sets: 3, reps: '10–15', rest: 120 },
    { id: 'reardelt', share: 1, n: 'Contractora inversa (deltoide posterior)', alt: 'o pájaros con mancuernas', sets: 3, reps: '15–20', rest: 0, ss: 1 },
    { id: 'hammer', n: 'Curl martillo con cuerda', alt: 'o curl martillo con mancuernas', sets: 3, reps: '12–15', rest: 60, ss: 1 },
    { id: 'reardeltx', n: 'Contractora inversa', alt: 'serie extra — mismo peso, suelta', sets: 1, reps: '15–20', rest: 60 },
  ]},
];

const DEFAULT_DAYS_PAREJA = [
  { name: 'Superior + Glúteo', sub: '', pair: 'Las estaciones 1–3 son compartidas: alternad series mientras el otro descansa. Os separáis en la contractora: él hace pecho y hombro, tú pasas al hip thrust.', ex: [
    { id: 'chestpress', n: 'Press de pecho en máquina', alt: 'o press de banca con barra', sets: 3, reps: '6–10', rest: 150, share: 1, cue: 'Bloque de fuerza — más peso, menos repeticiones' },
    { id: 'shoulderpress', n: 'Press de hombros en máquina', alt: 'o press militar con mancuernas', sets: 3, reps: '6–10', rest: 150, share: 1 },
    { id: 'cablerow', n: 'Remo sentado en polea', alt: 'o remo con apoyo pectoral', sets: 3, reps: '8–12', rest: 120, share: 1 },
    { id: 'hipthrust', n: 'Hip thrust con barra o máquina', alt: 'o hip thrust en multipower', sets: 4, add: 4, reps: '8–12', rest: 150, cue: 'El ejercicio clave de glúteo. Cárgalo y sube el peso.' },
    { id: 'kickback', n: 'Patada de glúteo en polea', alt: 'cada pierna', sets: 3, reps: '12–15', rest: 90 },
    { id: 'abduction1', n: 'Máquina de abductores', alt: 'inclínate ligeramente hacia delante', sets: 3, reps: '15–20', rest: 60 },
  ]},
  { name: 'Pierna fuerte', sub: '', pair: 'Casi toda la sesión es compartida: estaciones 1–3 juntos, alternando series. Él se va a jalones y brazo mientras tú terminas con zancadas y abductores.', ex: [
    { id: 'hacksquat', n: 'Sentadilla hack', alt: 'o pendular / sentadilla con barra', sets: 4, reps: '8–12', rest: 150, share: 1, cue: 'Pies algo más altos y abiertos para más glúteo' },
    { id: 'rdl', n: 'Peso muerto rumano en multipower', alt: 'o con barra libre', sets: 4, reps: '8–12', rest: 150, share: 1, cue: 'Lleva la cadera atrás, busca el estiramiento del femoral' },
    { id: 'legcurl', n: 'Curl femoral sentado', alt: '', sets: 3, reps: '12–15', rest: 90, share: 1 },
    { id: 'lunge', n: 'Zancadas caminando o sentadilla búlgara', alt: 'cada pierna', sets: 3, reps: '10–12', rest: 120 },
    { id: 'cablecurl', n: 'Curl en polea', alt: 'o curl inclinado con mancuernas', sets: 3, reps: '10–15', rest: 0, ss: 1, share: 1 },
    { id: 'ohext', n: 'Extensión de tríceps sobre la cabeza', alt: 'o extensiones en polea', sets: 3, reps: '12–15', rest: 90, ss: 1, share: 1 },
  ]},
  { name: 'Glúteo + Superior', sub: '', pair: 'Cuatro de seis estaciones compartidas. Él hace tres series de prensa y tú cuatro: aprovecha la última mientras él prepara la contractora inversa.', ex: [
    { id: 'pulldown', n: 'Jalón al pecho, agarre ancho', alt: 'o dominadas asistidas', sets: 3, add: 4, reps: '6–10', rest: 150, share: 1, cue: 'Bloque de fuerza — más peso, menos repeticiones' },
    { id: 'inclinepress', n: 'Press inclinado en máquina', alt: 'o press inclinado con mancuernas', sets: 3, reps: '8–12', rest: 120, share: 1 },
    { id: 'csrow', n: 'Remo en máquina con apoyo pectoral', alt: 'o remo con barra', sets: 3, reps: '8–12', rest: 120, share: 1 },
    { id: 'legpress', n: 'Prensa de piernas, pies altos y abiertos', alt: '', sets: 4, add: 6, reps: '10–15', rest: 150, share: 1, cue: 'Pies altos = más glúteo y menos cuádriceps' },
    { id: 'backext', n: 'Hiperextensiones a 45°', alt: 'con disco al pecho, redondeando un poco arriba', sets: 4, reps: '10–15', rest: 120 },
    { id: 'reardelt', n: 'Contractora inversa (deltoide posterior)', alt: 'o pájaros con mancuernas', sets: 3, reps: '15–20', rest: 0, ss: 1, share: 1 },
    { id: 'abduction2', n: 'Abducción de cadera en polea de pie', alt: 'o máquina de abductores', sets: 3, reps: '15–20', rest: 60, ss: 1 },
  ]},
];

function freshBlock(id, name, days, phase) {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    days: JSON.parse(JSON.stringify(days)),
    phase: JSON.parse(JSON.stringify(phase)),
  };
}

function defaultState() {
  const tuBlock = freshBlock('block-1', 'Bloque 1', DEFAULT_DAYS_TU, DEFAULT_PHASE_TU);
  const parejaBlock = freshBlock('block-1', 'Bloque 1', DEFAULT_DAYS_PAREJA, DEFAULT_PHASE_PAREJA);
  return {
    activeProfile: 'tu',
    profiles: {
      tu: {
        label: 'Tú',
        theme: 'tu',
        blocks: { [tuBlock.id]: tuBlock },
        blockOrder: [tuBlock.id],
        activeBlock: tuBlock.id,
        log: {},
        week: 1,
        day: 0,
      },
      pareja: {
        label: 'Pareja',
        theme: 'pareja',
        blocks: { [parejaBlock.id]: parejaBlock },
        blockOrder: [parejaBlock.id],
        activeBlock: parejaBlock.id,
        log: {},
        week: 1,
        day: 0,
      },
    },
  };
}
