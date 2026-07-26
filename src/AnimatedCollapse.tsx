import type { ReactNode } from 'react'

type AnimatedCollapseProps = {
  children: ReactNode
  id: string
  open: boolean
  className?: string
}

export function AnimatedCollapse({ children, id, open, className = '' }: AnimatedCollapseProps) {
  return (
    <div
      id={id}
      className={`animated-collapse${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden={!open}
    >
      <div className="animated-collapse-inner">
        {children}
      </div>
    </div>
  )
}
