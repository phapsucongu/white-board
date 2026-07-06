import type { RoomRole } from '../../api/client';

const roleStyles: Record<RoomRole, string> = {
  OWNER: 'bg-primary/10 text-primary border-primary/20',
  EDITOR: 'bg-tertiary/10 text-tertiary border-tertiary/20',
  VIEWER: 'bg-surface-bright text-on-surface-variant border-outline-variant'
};

export function RoleBadge({ role }: { role: RoomRole }) {
  return (
    <span className={`px-2 py-0.5 rounded text-label-code border ${roleStyles[role]}`}>
      {formatRole(role)}
    </span>
  );
}

function formatRole(role: RoomRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}
