import { mockStore } from '../lib/mockStore';

console.log('🌱 Starting ConfessionFlow Seed...');

mockStore.resetToDefaults();

const confessions = mockStore.getConfessions();
const templates = mockStore.getTemplates();
const settings = mockStore.getSettings();

console.log(`✅ Loaded ${templates.length} visual post templates.`);
console.log(`✅ Initialized store with ${confessions.length} confessions.`);
console.log(`✅ Default Brand: "${settings.brand_name}" (${settings.instagram_handle}).`);
console.log(`✅ Default Timezone: ${settings.timezone}`);
console.log('🎉 Store reset complete!');
