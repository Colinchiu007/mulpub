import { defineComponent, computed } from 'vue'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'text'
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
  disabled?: boolean
  icon?: string
  block?: boolean
}

export const Button = defineComponent({
  name: 'MpButton',
  props: {
    variant: {
      type: String as () => 'primary' | 'secondary' | 'danger' | 'text',
      default: 'primary'
    },
    size: {
      type: String as () => 'small' | 'medium' | 'large',
      default: 'medium'
    },
    loading: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    },
    icon: {
      type: String,
      default: ''
    },
    block: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    const handleClick = (event: MouseEvent) => {
      if (!props.loading && !props.disabled) {
        emit('click', event)
      }
    }

    return { handleClick }
  },
  template: `
    <button
      class="mp-button"
      :class="[
        `mp-button--${variant}`,
        `mp-button--${size}`,
        { 'mp-button--loading': loading, 'mp-button--disabled': disabled, 'mp-button--block': block }
      ]"
      @click="handleClick"
      :disabled="disabled || loading"
    >
      <span v-if="icon && !loading" class="mp-button__icon">{{ icon }}</span>
      <span v-if="loading" class="mp-button__spinner"></span>
      <span class="mp-button__content">
        <slot></slot>
      </span>
    </button>
  `,
  styles: `
    .mp-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      font-family: var(--font-family-sans);
      font-weight: var(--font-weight-medium);
      border-radius: var(--border-radius-md);
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
    }

    .mp-button--primary {
      background-color: var(--color-primary-500);
      color: white;
    }

    .mp-button--primary:hover:not(.mp-button--disabled) {
      background-color: var(--color-primary-600);
    }

    .mp-button--secondary {
      background-color: var(--color-neutral-200);
      color: var(--color-neutral-700);
    }

    .mp-button--secondary:hover:not(.mp-button--disabled) {
      background-color: var(--color-neutral-300);
    }

    .mp-button--danger {
      background-color: var(--color-error-500);
      color: white;
    }

    .mp-button--danger:hover:not(.mp-button--disabled) {
      background-color: var(--color-error-600);
    }

    .mp-button--text {
      background-color: transparent;
      color: var(--color-primary-500);
    }

    .mp-button--text:hover:not(.mp-button--disabled) {
      background-color: var(--color-primary-50);
    }

    .mp-button--small {
      padding: var(--spacing-2) var(--spacing-4);
      font-size: var(--font-size-sm);
      height: 32px;
    }

    .mp-button--medium {
      padding: var(--spacing-3) var(--spacing-6);
      font-size: var(--font-size-base);
      height: 40px;
    }

    .mp-button--large {
      padding: var(--spacing-4) var(--spacing-8);
      font-size: var(--font-size-lg);
      height: 48px;
    }

    .mp-button--loading,
    .mp-button--disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .mp-button--block {
      width: 100%;
    }

    .mp-button__icon {
      font-style: normal;
    }

    .mp-button__spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: mp-spin 0.75s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }

    .mp-button__content {
      display: flex;
      align-items: center;
    }
  `
})

export default Button
