//! GitHub-style two-word landscape names, used as the default project/list name
//! when the user hasn't chosen one. Mirrors the frontend `suggestName` list so
//! defaults created here (default project, tray Inbox) match the app's dice.

use std::hash::{BuildHasher, RandomState};

const ADJECTIVES: &[&str] = &[
    "Amber", "Arctic", "Autumn", "Breezy", "Bright", "Calm", "Cedar", "Clear",
    "Cloudy", "Coastal", "Cosmic", "Crimson", "Crisp", "Dappled", "Dewy", "Dusky",
    "Emerald", "Fabled", "Faded", "Fern", "Frosty", "Gilded", "Golden", "Hazy",
    "Hidden", "Hollow", "Indigo", "Ivory", "Jade", "Lively", "Lunar", "Misty",
    "Mossy", "Noble", "Northern", "Opal", "Pale", "Quiet", "Rustic", "Sable",
    "Sandy", "Silent", "Silver", "Solar", "Sunny", "Swift", "Tidal", "Velvet",
    "Verdant", "Wild",
];

const NOUNS: &[&str] = &[
    "Atlas", "Basin", "Bay", "Bluff", "Brook", "Canyon", "Cape", "Cavern",
    "Cliff", "Cove", "Creek", "Delta", "Dune", "Fjord", "Forest", "Gap",
    "Glacier", "Glade", "Grove", "Harbor", "Heath", "Hill", "Hollow", "Isle",
    "Knoll", "Lagoon", "Lake", "Meadow", "Mesa", "Moor", "Oasis", "Orchard",
    "Pass", "Peak", "Pine", "Plain", "Prairie", "Range", "Reef", "Ridge",
    "River", "Shore", "Summit", "Thicket", "Trail", "Tundra", "Vale", "Valley",
];

/// A random "Adjective Noun" name (e.g. "Amber Valley"). `RandomState` is
/// OS-seeded per call, so no external RNG dependency is needed.
pub fn suggest_name() -> String {
    let a = RandomState::new().hash_one("adj") as usize;
    let n = RandomState::new().hash_one("noun") as usize;
    format!("{} {}", ADJECTIVES[a % ADJECTIVES.len()], NOUNS[n % NOUNS.len()])
}
