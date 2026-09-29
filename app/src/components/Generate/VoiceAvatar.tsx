import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function VoiceAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('h-10 w-10 ring-1 ring-border', className)}>
      {avatarUrl && <AvatarImage src={apiClient.resolveUrl(avatarUrl)} alt="" draggable={false} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
