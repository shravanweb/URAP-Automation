// Presentation data for the connector catalog. The connectors themselves come from /api/connectors;
// this only maps each id to a category, an icon, and an icon tint. Unknown ids fall back to "Other".
export const CATEGORIES = [
  ['all', 'All'],
  ['ai', 'AI'],
  ['files', 'Data & files'],
  ['databases', 'Databases'],
  ['communication', 'Communication'],
  ['web', 'Web & API'],
  ['security', 'Security'],
];

const LOOK = {
  ai_provider: ['ai', 'sparkle', 'bg-[#F1EDFB] text-[#6941C6]'],
  excel: ['files', 'table', 'bg-[#E8F5EC] text-[#1E8E3E]'],
  csv: ['files', 'text', 'bg-[#E8F5EC] text-[#1E8E3E]'],
  pdf_text: ['files', 'document', 'bg-[#FDECEC] text-[#C2410C]'],
  file_storage: ['files', 'folder', 'bg-[#FFF4E5] text-[#B45309]'],
  google_sheets: ['files', 'table', 'bg-[#E8F5EC] text-[#1E8E3E]'],
  mysql: ['databases', 'database', 'bg-[#EAF1FB] text-[#2F6FD0]'],
  postgres: ['databases', 'database', 'bg-[#EAF1FB] text-[#2F6FD0]'],
  email: ['communication', 'mail', 'bg-[#FFF4E5] text-[#B45309]'],
  rest_api: ['web', 'api', 'bg-[#EAF1FB] text-[#2F6FD0]'],
  browser_uipath: ['web', 'globe', 'bg-[#EAF1FB] text-[#2F6FD0]'],
  credential: ['security', 'lock', 'bg-[#F3F4F6] text-[#4B5563]'],
};

export function connectorLook(id) {
  const [category, icon, tint] = LOOK[id] || ['other', 'link', 'bg-[#F3F4F6] text-[#4B5563]'];
  return { category, icon, tint };
}

export function availabilityLabel(value) {
  if (value === 'available') return { label: 'Available', tone: 'bg-[#E8F5EC] text-[#1E7A3A]' };
  if (value === 'requires_robot') return { label: 'Requires robot', tone: 'bg-[#FFF4E5] text-[#9A5B00]' };
  return { label: String(value || 'Unknown').replace(/_/g, ' '), tone: 'bg-[#F3F4F6] text-[#4B5563]' };
}

/** Filters by category and a search over name, key, and description. */
export function filterConnectors(connectors, { category = 'all', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return (connectors || []).filter((item) => {
    if (category !== 'all' && connectorLook(item.id).category !== category) return false;
    if (!needle) return true;
    return [item.id, item.displayName, item.description].some((value) => String(value || '').toLowerCase().includes(needle));
  });
}

/** Count per category for the chips (only categories with connectors are worth showing). */
export function categoryCounts(connectors) {
  const counts = { all: (connectors || []).length };
  for (const item of connectors || []) {
    const { category } = connectorLook(item.id);
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}
