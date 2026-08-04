import React from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'dashed' | 'success' | 'info'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
  iconOnly?: boolean
  block?: boolean
  loading?: boolean
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  icon,
  iconOnly = false,
  block = false,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}) => {
  const cls = [
    styles.button,
    variant !== 'default' && styles[variant],
    size === 'sm' && styles.sm,
    iconOnly && styles.iconOnly,
    block && styles.block,
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {!iconOnly && children}
    </button>
  )
}
