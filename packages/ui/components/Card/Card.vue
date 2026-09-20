import { defineComponent, computed } from 'vue'

interface CardProps {
  title?: string
  subtitle?: string
  footer?: string
  variant?: 'elevated' | 'outlined' | 'filled'
  size?: 'small' | 'medium' | 'large'
  hoverable?: boolean
  shadow?: boolean
}

export const Card = defineComponent({
  name: 'MpCard',
  props: {
    title: {
      type: String,
      default: ''
    },
    subtitle: {
      type: String,
      default: ''
    },
    footer: {
      type: String,
      default: ''
    },
    variant: {
      type: String as () => 'elevated' | 'outlined' | 'filled',
      default: 'elevated'
    },
    size: {
      type: String as () => 'small' | 'medium' | 'large',
      default: 'medium'
    },
    hoverable: {
      type: Boolean,
      default: false
    },
    shadow: {
      type: Boolean,
      default: true
    }
  },
  setup(props, { slots }) {
    const cardClass = computed(() => {
      return [
        'mp-card',
        `mp-card--${props.variant}`,
        `mp-card--${props.size}`,
        { 
          'mp-card--hoverable': props.hoverable,
          'mp-card--no-shadow': !props.shadow
        }
      ]
    })

    return { cardClass }
  },
  template: `
    <div :class="cardClass">
      <header v-if="title || $slots.header" class="mp-card__header">
        <h3 class="mp-card__title">{{ title }}</h3>
        <p v-if="subtitle" class="mp-card__subtitle">{{ subtitle }}</p>
        <slot name="header"></slot>
      </header>
      
      <div class="mp-card__content">
        <slot></slot>
      </div>
      
      <footer v-if="footer || $slots.footer" class="mp-card__footer">
        {{ footer }}
        <slot name="footer"></slot>
      </footer>
    </div>
  `,
  styles: `
    .mp-card {
      display: flex;
      flex-direction: column;
      background-color: white;
      border-radius: var(--border-radius-md);
      transition: all 0.15s ease;
    }

    .mp-card--elevated {
      box-shadow: var(--shadow-md);
    }

    .mp-card--elevated.mp-card--hoverable:hover {
      box-shadow: var(--shadow-lg);
      transform: translateY(-2px);
    }

    .mp-card--outlined {
      border: 1px solid var(--color-neutral-200);
    }

    .mp-card--outlined.mp-card--hoverable:hover {
      border-color: var(--color-primary-300);
    }

    .mp-card--filled {
      background-color: var(--color-neutral-50);
    }

    .mp-card--no-shadow {
      box-shadow: none !important;
    }

    .mp-card--small {
      padding: var(--spacing-4);
    }

    .mp-card--medium {
      padding: var(--spacing-6);
    }

    .mp-card--large {
      padding: var(--spacing-8);
    }

    .mp-card__header {
      margin-bottom: var(--spacing-4);
      padding-bottom: var(--spacing-3);
      border-bottom: 1px solid var(--color-neutral-200);
    }

    .mp-card__title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0;
    }

    .mp-card__subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      margin: var(--spacing-1) 0 0 0;
    }

    .mp-card__content {
      flex: 1;
      color: var(--color-neutral-700);
    }

    .mp-card__footer {
      margin-top: var(--spacing-4);
      padding-top: var(--spacing-3);
      border-top: 1px solid var(--color-neutral-200);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      text-align: center;
    }
  `
})

export default Card
