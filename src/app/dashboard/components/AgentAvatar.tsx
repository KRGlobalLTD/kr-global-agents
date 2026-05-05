interface AgentAvatarProps {
  name:      string;
  size?:     number;
  className?: string;
}

export function AgentAvatar({ name, size = 32, className = '' }: AgentAvatarProps) {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '');
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/avatars/${slug}.svg`}
      alt={name}
      width={size}
      height={size}
      className={`rounded-full flex-shrink-0 ${className}`}
      style={{ objectFit: 'cover' }}
    />
  );
}
