// GitHub-style two-word name suggestions, themed around landscapes to suit
// "Taskscape". Purely cosmetic defaults the user can overwrite.

const ADJECTIVES = [
  "amber", "arctic", "autumn", "breezy", "bright", "calm", "cedar", "clear",
  "cloudy", "coastal", "cosmic", "crimson", "crisp", "dappled", "dewy", "dusky",
  "emerald", "fabled", "faded", "fern", "frosty", "gilded", "golden", "hazy",
  "hidden", "hollow", "indigo", "ivory", "jade", "lively", "lunar", "misty",
  "mossy", "noble", "northern", "opal", "pale", "quiet", "rustic", "sable",
  "sandy", "silent", "silver", "solar", "sunny", "swift", "tidal", "velvet",
  "verdant", "wild",
];

const NOUNS = [
  "atlas", "basin", "bay", "bluff", "brook", "canyon", "cape", "cavern",
  "cliff", "cove", "creek", "delta", "dune", "fjord", "forest", "gap",
  "glacier", "glade", "grove", "harbor", "heath", "hill", "hollow", "isle",
  "knoll", "lagoon", "lake", "meadow", "mesa", "moor", "oasis", "orchard",
  "pass", "peak", "pine", "plain", "prairie", "range", "reef", "ridge",
  "river", "shore", "summit", "thicket", "trail", "tundra", "vale", "valley",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function suggestName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}
