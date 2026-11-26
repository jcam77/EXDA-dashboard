import React from 'react';
import { Activity, Cog, Flame, Gauge, HardHat, ListChecks, ShieldCheck, Warehouse } from 'lucide-react';

// Icon of a checklist group. The four original groups keep distinct theme colours;
// other icons use the app's accent colour.
const ICONS = {
  'list-checks': [ListChecks, 'text-primary'],
  warehouse: [Warehouse, 'text-muted-foreground'],
  'hard-hat': [HardHat, 'text-warning'],
  cog: [Cog, 'text-info'],
  activity: [Activity, 'text-destructive'],
  flame: [Flame, 'text-primary'],
  gauge: [Gauge, 'text-primary'],
  shield: [ShieldCheck, 'text-primary'],
};

const ChecklistGroupIcon = ({ name, size = 24 }) => {
  const [Icon, colour] = ICONS[name] || ICONS['list-checks'];
  return <Icon size={size} className={`shrink-0 ${colour}`} />;
};

export default ChecklistGroupIcon;
