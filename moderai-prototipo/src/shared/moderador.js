/** Decide si un post se difumina: certeza del modelo vs. umbral (sensibilidad global del popup ± ajuste de la regla). */
const ModerAIDecision = (() => {
  const AJUSTE = { Baja: 15, Normal: 0, Alta: -15 }; // Baja = más difícil difuminar; Alta = más fácil
  const ETIQUETA = { SPOILER: "Spoiler", SPAM: "Spam", HATE_SPEECH: "Odio", CUSTOM_PROMPT: "Personalizada" };
  const umbral = (nivel, sens) => Math.min(99, Math.max(5, nivel + (AJUSTE[sens] ?? 0)));
  function decidir(scores, reglas, nivel) { // scores: { id_regla: certeza }
    let mejor = null;
    for (const r of reglas) {
      const c = scores[r.id_regla];
      if (c === undefined) continue;
      const u = umbral(nivel, r.sensibilidad), margen = c - u;
      if (!mejor || margen > mejor.margen) mejor = { regla: r, certeza: c, umbral: u, margen };
    }
    return mejor && { ...mejor, difuminar: mejor.margen >= 0 };
  }
  return { umbral, decidir, ETIQUETA };
})();
if (typeof module !== "undefined") module.exports = ModerAIDecision;
