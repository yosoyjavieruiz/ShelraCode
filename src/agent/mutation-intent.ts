/**
 * Single source of truth for "does this objective/node text describe a
 * workspace mutation" — English and Spanish verbs, in their common inflected
 * forms. Several call sites (turn routing, plan-node validation, completion
 * review, task classification) each used to keep their own hand-rolled word
 * list; those lists drifted (a verb present in one was missing from
 * another), so the same objective text could be classified as a mutation by
 * one gate and not by another.
 *
 * Forms are spelled out explicitly rather than matched via a stem + `\w*`
 * wildcard: a wildcard after "implement" also matches "implementation", after
 * "configur(e)" also matches "configuration", after "modif(y)" also matches
 * "modification" — all common nouns in technical writing that describe
 * something, not a request to change it.
 *
 * Past-tense/participle forms ("built", "changed", "installed", "written",
 * "removed", ...) are deliberately excluded entirely, not just the irregular
 * ones: they are exactly the forms English and Spanish use to describe
 * existing state passively ("this project is built with Vite", "the
 * dependency is already installed", "what changed between v1 and v2", "el
 * script ya fue reparado") rather than to request a change. An objective
 * asking for work uses the imperative, present, or gerund form instead
 * ("build", "builds", "building" / "instala", "instalando"); those forms
 * carry the actual signal this lexicon needs and do not have the same
 * passive-voice collision.
 */

const MUTATION_WORDS = [
  // English
  "add",
  "adds",
  "adding",
  "build",
  "builds",
  "building",
  "change",
  "changes",
  "changing",
  "configure",
  "configures",
  "configuring",
  "correct",
  "corrects",
  "correcting",
  "create",
  "creates",
  "creating",
  "delete",
  "deletes",
  "deleting",
  "edit",
  "edits",
  "editing",
  "fix",
  "fixes",
  "fixing",
  "generate",
  "generates",
  "generating",
  "implement",
  "implements",
  "implementing",
  "install",
  "installs",
  "installing",
  "migrate",
  "migrates",
  "migrating",
  "modify",
  "modifies",
  "modifying",
  "patch",
  "patches",
  "patching",
  "refactor",
  "refactors",
  "refactoring",
  "remove",
  "removes",
  "removing",
  "rename",
  "renames",
  "renaming",
  "repair",
  "repairs",
  "repairing",
  "update",
  "updates",
  "updating",
  "write",
  "writes",
  "writing",
  // Spanish
  "agrega",
  "agregar",
  "agregando",
  "anade",
  "anadir",
  "anadiendo",
  "arregla",
  "arreglar",
  "arreglando",
  "borra",
  "borrar",
  "borrando",
  "cambia",
  "cambiar",
  "cambiando",
  "cambio",
  "configura",
  "configurar",
  "configurando",
  "construye",
  "construir",
  "construyendo",
  "corrige",
  "corregir",
  "corrigiendo",
  "crea",
  "crear",
  "creando",
  "elimina",
  "eliminar",
  "eliminando",
  "escribe",
  "escribir",
  "escribiendo",
  "genera",
  "generar",
  "generando",
  "implementa",
  "implementar",
  "implementando",
  "instala",
  "instalar",
  "instalando",
  "migra",
  "migrar",
  "migrando",
  "modifica",
  "modificar",
  "modificando",
  "parchea",
  "parchear",
  "parcheando",
  "refactoriza",
  "refactorizar",
  "refactorizando",
  "renombra",
  "renombrar",
  "renombrando",
  "repara",
  "reparar",
  "reparando",
  "actualiza",
  "actualizar",
  "actualizando",
] as const;

const MUTATION_VERB_PATTERN = new RegExp(
  `\\b(?:${MUTATION_WORDS.join("|")})\\b`,
  "iu",
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** Whether the text contains a mutation-implying verb, English or Spanish, regardless of accents or inflection. */
export function describesMutation(text: string): boolean {
  return MUTATION_VERB_PATTERN.test(normalize(text));
}
