/* Default seed data — used only the first time the app runs on a device
   (or after "Borrar todos los datos"). Editing after that happens through
   the "Editar plan" screen in the app itself, not this file.

   This has to stay hardcoded (not fetched) so the app boots with a real
   plan on the very first load, offline included. blocks/hombre-bloque-1.json
   and blocks/mujer-bloque-1.json are exported copies of the same content
   for the "Importar JSON" flow (e.g. resetting to Bloque 1) — if you edit
   the plans here, regenerate those two files to match, or they'll drift.

   The two profiles are built around different priorities, and the day
   split follows from them:

   - Hombre: upper body is the priority, legs are maintenance. Every
     upper muscle is trained twice a week; legs get 11 sets total.
   - Mujer: legs are the priority, and each muscle is trained on exactly
     one day of the week, counting the indirect work compounds do. That
     is why biceps sit with back and triceps sit with the presses —
     separating them would add an exposure, not remove one. Glutes are
     the one exception, since squats and leg presses train them whatever
     else you do.

   The two plans share 12 exercises (marked `share`), spread 5/5/2 across
   the week, so the sessions can be run together alternating sets. */

const DEFAULT_PHASE_TU = {
  1: { r: '3 RIR', t: 'Semana de calibración. Anota pesos y quédate corto: técnica y rango completo.' },
  2: { r: '2–3 RIR', t: 'Mismo peso que S1, intenta sumar repeticiones. Sube peso solo si llegaste al tope del rango en todas las series.' },
  3: { r: '2 RIR', t: 'Doble progresión: tope del rango en todas las series → +2,5 kg (o el escalón más pequeño) la semana siguiente.' },
  4: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena visiblemente.' },
  5: { r: '1–2 RIR', t: '+1 serie en press de pecho y en jalón al pecho.' },
  6: { r: '1 RIR', t: 'Semana dura. Mantén el rango completo aunque baje el peso.' },
  7: { r: '0–1 RIR', t: '+1 serie en press de hombros. Última serie al fallo SOLO en máquinas y aislamiento — nunca en hack ni peso muerto rumano.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

const DEFAULT_PHASE_PAREJA = {
  1: { r: '3 RIR', t: 'Semana de calibración. Anota pesos y quédate corta: técnica y rango completo.' },
  2: { r: '2–3 RIR', t: 'Mismo peso que S1, intenta sumar repeticiones. Sube peso solo si llegaste al tope del rango en todas las series.' },
  3: { r: '2 RIR', t: 'Doble progresión: tope del rango en todas las series → +2,5 kg (o el escalón más pequeño) la semana siguiente.' },
  4: { r: '1–2 RIR', t: 'Series de trabajo. La última repetición se frena visiblemente.' },
  5: { r: '1–2 RIR', t: '+1 serie en sentadilla hack, press de pecho e hip thrust.' },
  6: { r: '1 RIR', t: 'Semana dura. Cada músculo se entrena un solo día: no te guardes nada, no hay segunda oportunidad esta semana.' },
  7: { r: '0–1 RIR', t: '+1 serie en jalón al pecho y peso muerto rumano. Última serie al fallo SOLO en máquinas y aislamiento — nunca en hack, rumano ni hip thrust pesado.' },
  8: { r: 'Descarga', t: 'Mitad de series, ~60% del peso. Nada duro. De eso se trata.' },
};

const DEFAULT_DAYS_TU = [
  { name: 'Empuje', pair: 'Dia casi entero compartido: press de pecho, laterales, press de hombros, contractora y triceps en polea. Tu press inclinado lo haces por tu cuenta.', ex: [
    { id: 'chestpress', share: 1, n: 'Press de pecho en máquina', alt: 'o press de banca con barra', sets: 4, add: 5, reps: '6–10', rest: 150, cue: 'El ejercicio pesado del día: llega a 10 reps limpias en las 4 series antes de subir peso' },
    { id: 'lat1', share: 1, n: 'Elevaciones laterales en polea', alt: 'o con mancuernas', sets: 4, reps: '12–20', rest: 60, cue: 'Van aquí a propósito: hoy no hay remos, y son lo único que deja descansar al hombro frontal entre press y press' },
    { id: 'shoulderpress', share: 1, n: 'Press de hombros en máquina', alt: 'o press militar con mancuernas', sets: 4, add: 7, reps: '8–12', rest: 150 },
    { id: 'inclinepress', n: 'Press inclinado en máquina', alt: 'o press inclinado con mancuernas', sets: 4, reps: '8–12', rest: 150 },
    { id: 'pecdeck', share: 1, n: 'Contractora / aperturas en polea', alt: 'o aperturas con mancuernas', sets: 4, reps: '12–15', rest: 90, cue: 'Estirar del todo atrás — sin recortar el recorrido' },
    { id: 'pushdown', share: 1, n: 'Extensiones de tríceps en polea', alt: 'o press francés', sets: 4, reps: '12–15', rest: 75 },
  ]},
  { name: 'Tirón + Cuádriceps', pair: 'Compartis hack, jalon, remo y la superserie final. Ella hace prensa y extension de cuadriceps mientras tu haces tu prensa y el jalon neutro.', ex: [
    { id: 'hacksquat', share: 1, n: 'Sentadilla hack', alt: 'o pendular / sentadilla con barra', sets: 3, reps: '8–12', rest: 150, cue: 'Dosis corta de pierna: 3 series bien hechas, profundidad por debajo de la paralela' },
    { id: 'legpress', n: 'Prensa de piernas', alt: '', sets: 3, reps: '10–15', rest: 120 },
    { id: 'pulldown_w', share: 1, n: 'Jalón al pecho, agarre ancho', alt: 'o dominadas', sets: 4, add: 5, reps: '8–12', rest: 150, cue: 'El ejercicio pesado del día. Pecho arriba, codos hacia los bolsillos' },
    { id: 'csrow', share: 1, n: 'Remo en máquina con apoyo pectoral', alt: 'o remo con barra', sets: 4, reps: '10–15', rest: 120 },
    { id: 'pulldown_n', n: 'Jalón agarre neutro', alt: 'o dominadas asistidas / pullover en polea', sets: 3, reps: '10–12', rest: 120 },
    { id: 'reardelt', share: 1, n: 'Contractora inversa (deltoide posterior)', alt: 'o pájaros con mancuernas', sets: 4, reps: '15–20', rest: 0, ss: 1 },
    { id: 'hammer', share: 1, n: 'Curl martillo con cuerda', alt: 'o curl martillo con mancuernas', sets: 4, reps: '12–15', rest: 75, ss: 1 },
  ]},
  { name: 'Pecho/Brazo + Isquios', pair: 'Compartis peso muerto rumano y curl femoral al empezar. Despues ella sigue con gluteo, gemelo y abdomen mientras tu haces tu segunda sesion de pecho, espalda y brazo.', ex: [
    { id: 'rdl', share: 1, n: 'Peso muerto rumano en multipower', alt: 'o hiperextensiones a 45°', sets: 3, reps: '8–12', rest: 150, cue: 'Cadera atrás, busca el estiramiento del femoral. Sin redondear la espalda' },
    { id: 'legcurl', share: 1, n: 'Curl femoral sentado', alt: 'o curl femoral tumbado', sets: 2, reps: '12–15', rest: 90 },
    { id: 'dbpress', n: 'Press plano con mancuernas', alt: 'o fondos en máquina asistida', sets: 3, reps: '8–12', rest: 120, cue: 'Segunda sesión de pecho de la semana — libre y con recorrido largo, distinto a las máquinas del día de empuje' },
    { id: 'cablerow', n: 'Remo sentado en polea', alt: 'o remo con apoyo pectoral', sets: 3, reps: '10–15', rest: 120 },
    { id: 'inclinecurl', n: 'Curl inclinado en polea', alt: 'o curl inclinado con mancuernas', sets: 4, reps: '10–15', rest: 0, ss: 1, cue: 'Codos por detrás del torso' },
    { id: 'ohext', n: 'Extensión de tríceps sobre la cabeza', alt: 'en polea o con mancuerna', sets: 4, reps: '12–15', rest: 75, ss: 1 },
    { id: 'lat2', n: 'Elevaciones laterales en polea', alt: 'o con mancuernas', sets: 4, reps: '12–20', rest: 60 },
  ]},
];

const DEFAULT_DAYS_PAREJA = [
  { name: 'Pecho + Hombro', pair: 'Día casi entero compartido: press de pecho, laterales, press de hombros, contractora y tríceps en polea. Él añade su press inclinado por su cuenta.', ex: [
    { id: 'chestpress', share: 1, n: 'Press de pecho en máquina', alt: 'o press de banca con barra', sets: 4, add: 5, reps: '6–10', rest: 150, cue: 'Bloque de fuerza — más peso, menos repeticiones' },
    { id: 'lat1', share: 1, n: 'Elevaciones laterales en polea', alt: 'o con mancuernas', sets: 4, reps: '12–20', rest: 60, cue: 'Van en segundo lugar a propósito: al no haber remos hoy, son lo único que deja descansar al hombro frontal entre press y press' },
    { id: 'shoulderpress', share: 1, n: 'Press de hombros en máquina', alt: 'o press militar con mancuernas', sets: 3, reps: '8–12', rest: 150 },
    { id: 'inclinepress', n: 'Press inclinado en máquina', alt: 'o press inclinado con mancuernas', sets: 3, reps: '8–12', rest: 120 },
    { id: 'pecdeck', share: 1, n: 'Contractora / aperturas en polea', alt: 'o aperturas con mancuernas', sets: 3, reps: '12–15', rest: 90, cue: 'Estirar del todo atrás — sin recortar el recorrido' },
    { id: 'pushdown', share: 1, n: 'Extensiones de tríceps en polea', alt: 'o press francés', sets: 3, reps: '12–15', rest: 0, ss: 1 },
    { id: 'ohext', n: 'Extensión de tríceps sobre la cabeza', alt: 'en polea o con mancuerna', sets: 3, reps: '12–15', rest: 75, ss: 1, cue: 'Tríceps solo hoy: los dos ejercicios juntos, y el resto de la semana descansan' },
  ]},
  { name: 'Cuádriceps + Espalda', pair: 'Compartís hack, jalón, remo y la superserie final. Tú haces prensa y extensión de cuádriceps mientras él hace su prensa y el jalón neutro. Bíceps solo hoy: todo el trabajo de brazo va junto al de dorsal, para que descansen los otros dos días.', ex: [
    { id: 'hacksquat', share: 1, n: 'Sentadilla hack', alt: 'o pendular / sentadilla con barra', sets: 4, add: 5, reps: '8–12', rest: 180, cue: 'Pies algo más altos y abiertos para más glúteo. Empieza el día con lo que más te importa' },
    { id: 'legpress', n: 'Prensa de piernas, pies altos y abiertos', alt: 'o zancadas caminando', sets: 3, reps: '10–15', rest: 150 },
    { id: 'legext', n: 'Extensión de cuádriceps', alt: 'o sentadilla búlgara', sets: 3, reps: '12–15', rest: 90, cue: 'Cierra el cuádriceps aquí: es el único día que lo entrenas' },
    { id: 'pulldown', share: 1, n: 'Jalón al pecho, agarre ancho', alt: 'o dominadas asistidas', sets: 4, add: 7, reps: '8–12', rest: 150, cue: 'Pecho arriba, codos hacia los bolsillos' },
    { id: 'csrow', share: 1, n: 'Remo en máquina con apoyo pectoral', alt: 'o remo sentado en polea', sets: 3, reps: '10–15', rest: 120 },
    { id: 'reardelt', share: 1, n: 'Contractora inversa (deltoide posterior)', alt: 'o pájaros con mancuernas', sets: 3, reps: '15–20', rest: 0, ss: 1 },
    { id: 'cablecurl', n: 'Curl en polea', alt: 'o curl inclinado con mancuernas', sets: 3, reps: '10–15', rest: 75, ss: 1, cue: 'El bíceps ya viene calentito del jalón y el remo: no necesita mucho peso para trabajar' },
    { id: 'hammer', share: 1, n: 'Curl martillo con cuerda', alt: 'o curl martillo con mancuernas', sets: 3, reps: '12–15', rest: 60 },
  ]},
  { name: 'Glúteo + Isquios', pair: 'Compartís peso muerto rumano y curl femoral. El resto del día es tuyo: él sigue con pecho, espalda y brazo mientras tú acabas glúteo, gemelo y abdomen.', ex: [
    { id: 'hipthrust', n: 'Hip thrust con barra o máquina', alt: 'o hip thrust en multipower', sets: 4, add: 5, reps: '8–12', rest: 150, cue: 'El ejercicio clave de glúteo. Cárgalo y sube el peso. Barbilla al pecho, pausa 1s arriba' },
    { id: 'rdl', share: 1, n: 'Peso muerto rumano en multipower', alt: 'o con barra libre', sets: 4, add: 7, reps: '8–12', rest: 150, cue: 'Lleva la cadera atrás, busca el estiramiento del femoral. Sin redondear la espalda' },
    { id: 'legcurl', share: 1, n: 'Curl femoral sentado', alt: 'o curl femoral tumbado', sets: 3, reps: '10–15', rest: 90 },
    { id: 'kickback', n: 'Patada de glúteo en polea', alt: 'cada pierna', sets: 3, reps: '12–15', rest: 90, cue: 'Si el día se alarga, este es el primero que se cae: repite lo que ya hace el hip thrust' },
    { id: 'abduction', n: 'Abducción de cadera (máquina o polea)', alt: 'inclínate ligeramente hacia delante', sets: 3, reps: '15–20', rest: 60 },
    { id: 'calfstand', n: 'Elevación de gemelos de pie', alt: 'o en prensa / multipower', sets: 4, reps: '8–15', rest: 0, ss: 1, cue: 'Pausa 1-2s abajo en el estiramiento, sin rebotar' },
    { id: 'abs', n: 'Crunch en polea o rueda abdominal', alt: 'o plancha con peso', sets: 3, reps: '10–15', rest: 60, ss: 1 },
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
    activeProfile: 'hombre',
    profiles: {
      hombre: {
        label: 'Hombre',
        theme: 'hombre',
        blocks: { [tuBlock.id]: tuBlock },
        blockOrder: [tuBlock.id],
        activeBlock: tuBlock.id,
        log: {},
        week: 1,
        day: 0,
      },
      mujer: {
        label: 'Mujer',
        theme: 'mujer',
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
