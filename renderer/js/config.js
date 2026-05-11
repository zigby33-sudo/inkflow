export const CHANGELOG = [
  { icon: '📁', title: 'Renderer layout', desc: 'UI code split under renderer/js/ so each area is easier to find.' },
  { icon: '🔧', title: 'Search from browse', desc: 'MAL / MangaPlus cards jump to search again (regression fix).' },
];

export const GENRE_TAGS = [
  { label: '⚔️ Action', id: '391b0423-d847-456f-aff0-8b0cfc03066b' },
  { label: '💘 Romance', id: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9' },
  { label: '😂 Comedy', id: '4d32cc48-9f00-4cca-9b5a-a839f0764984' },
  { label: '👻 Horror', id: 'cdad7e68-1419-41dd-bdce-27753074a640' },
  { label: '🌟 Fantasy', id: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc' },
  { label: '🔬 Sci-Fi', id: '256c8bd9-4904-4360-bf4f-508a76d67183' },
  { label: '🧟 Isekai', id: 'ace04997-f6bd-436e-b261-779182193d3d' },
  { label: '🥊 Sports', id: '69964a64-2f90-4d33-beeb-e3bdbbe4a929' },
];

export const DEFAULT_SOURCES = {
  mangadex: { enabled: true, name: 'MangaDex' },
  mal: { enabled: false, name: 'MyAnimeList' },
  mangaplus: { enabled: false, name: 'MangaPlus' },
  comick: { enabled: false, name: 'Comick' },
};
