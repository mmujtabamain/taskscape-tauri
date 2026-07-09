//! Default project/list names used when the user hasn't chosen one. Projects
//! draw a single celestial name (`PROJECT_NAMES`); lists draw a two-word
//! landscape name (`ADJECTIVES` + `NOUNS`). Mirrors the frontend `nameSuggest`
//! lists so defaults created here (default project, tray Inbox) match the
//! app's dice.

use std::hash::{BuildHasher, RandomState};

const PROJECT_NAMES: &[&str] = &[
    "Acheron", "Adrastea", "Aegir", "Albiorix", "Altair", "Amalthea",
    "Andromeda", "Ariel", "Arrokoth", "Atlas", "Bellatrix", "Callisto",
    "Calypso", "Capella", "Carina", "Cassiopeia", "Ceres", "Charon",
    "Cordelia", "Deimos", "Despina", "Dione", "Draco", "Elara", "Enceladus",
    "Eris", "Europa", "Fomalhaut", "Ganymede", "Haumea", "Helene", "Hyperion",
    "Hydra", "Iapetus", "Io", "Janus", "Larissa", "Makemake", "Mimas",
    "Miranda", "Nereid", "Nix", "Oberon", "Orion", "Pallas", "Pandora",
    "Phobos", "Phoebe", "Pluto", "Proteus", "Rhea", "Rigel", "Sedna", "Sirius",
    "Tethys", "Titan", "Titania", "Triton", "Umbriel", "Vega", "Vesta",
];

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

/// A random celestial name (e.g. "Callisto") for a new project. `RandomState`
/// is OS-seeded per call, so no external RNG dependency is needed.
pub fn suggest_project_name() -> String {
    let i = RandomState::new().hash_one("project") as usize;
    PROJECT_NAMES[i % PROJECT_NAMES.len()].to_string()
}

/// A random "Adjective Noun" name (e.g. "Amber Valley") for a new list.
pub fn suggest_list_name() -> String {
    let a = RandomState::new().hash_one("adj") as usize;
    let n = RandomState::new().hash_one("noun") as usize;
    format!("{} {}", ADJECTIVES[a % ADJECTIVES.len()], NOUNS[n % NOUNS.len()])
}
