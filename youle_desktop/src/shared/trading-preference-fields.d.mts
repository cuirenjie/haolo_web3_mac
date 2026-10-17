export const TRADING_PREFERENCE_CHOICE_FIELDS: Record<1 | 2 | 3, Array<{
  id: string;
  title: string;
  multiple?: boolean;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
  placeholder: string;
}>>;
