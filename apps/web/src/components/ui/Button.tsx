import clsx from 'clsx';
import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'aria-haspopup' | 'aria-expanded' | 'title'> {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'thermal';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}

export const THERMAL_BUTTON_COLORS = {
  background: '#9d5637',
  foreground: '#ffffff',
  hoverBackground: '#7d442f',
  disabledBackground: '#f3efe8',
  disabledForeground: '#5c4439',
  focusRing: '#b86843',
} as const;

const variants = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-transparent',
  secondary: 'bg-white text-stone-700 hover:bg-stone-50 border-stone-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-transparent',
  ghost: 'bg-transparent text-stone-600 hover:bg-stone-100 border-transparent',
  thermal: 'bg-[#9d5637] text-white hover:bg-[#7d442f] border-[#7d442f] disabled:bg-[#f3efe8] disabled:text-[#5c4439] disabled:hover:bg-[#f3efe8] disabled:hover:text-[#5c4439] disabled:opacity-100 focus-visible:ring-2 focus-visible:ring-[#b86843] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbfaf7]',
};

const sizes = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

export default function Button({ children, onClick, variant = 'secondary', size = 'md', type = 'button', disabled, className }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx('inline-flex items-center gap-1.5 rounded font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
    >
      {children}
    </button>
  );
}
