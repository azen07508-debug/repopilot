/**
 * What counts as a programming language.
 *
 * Both intelligence artifacts need this question answered the same way: the
 * Repository Map asks it to pick a `primaryLanguage`, and the Symbol Map
 * asks it to decide what is worth parsing. Two copies would eventually
 * disagree, and "this repository is 40% JSON" is exactly the kind of answer
 * one of them would give.
 *
 * The formats are recognised, not ignored — `RepositoryMap.languages`
 * reports every one of them by bytes. They are only excluded from questions
 * about what the repository is *written in*.
 */
const NON_PROGRAMMING_LANGUAGES = new Set(['JSON', 'YAML', 'TOML', 'Markdown']);

export function isProgrammingLanguage(language: string): boolean {
  return !NON_PROGRAMMING_LANGUAGES.has(language);
}
