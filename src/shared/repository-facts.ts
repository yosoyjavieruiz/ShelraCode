export function isDirectRepositoryFactQuestion(objective: string): boolean {
  const normalized = objective
    .trim()
    .replace(/^[?!¿¡]+/u, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const asksForFact = /^(?:what|which|que|cual)\b/.test(normalized);
  const factSubject =
    /\b(?:programming language|language|tech stack|technology stack|framework|runtime|project name|lenguaje de programacion|lenguaje|stack tecnologico|tecnologia|nombre del proyecto|entorno de ejecucion)\b/.test(
      normalized,
    );
  return asksForFact && factSubject;
}
