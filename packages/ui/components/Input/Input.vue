import { defineComponent, ref, computed, watch } from 'vue'

interface InputProps {
  modelValue?: string | number
  type?: 'text' | 'password' | 'email' | 'number'
  placeholder?: string
  size?: 'small' | 'medium' | 'large'
  disabled?: boolean
  loading?: boolean
  error?: boolean
  success?: boolean
  prefix?: string
  suffix?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  required?: boolean
}

export const Input = defineComponent({
  name: 'MpInput',
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    type: {
      type: String as () => 'text' | 'password' | 'email' | 'number',
      default: 'text'
    },
    placeholder: {
      type: String,
      default: ''
    },
    size: {
      type: String as () => 'small' | 'medium' | 'large',
      default: 'medium'
    },
    disabled: {
      type: Boolean,
      default: false
    },
    loading: {
      type: Boolean,
      default: false
    },
    error: {
      type: Boolean,
      default: false
    },
    success: {
      type: Boolean,
      default: false
    },
    prefix: {
      type: String,
      default: ''
    },
    suffix: {
      type: String,
      default: ''
    },
    minLength: {
      type: Number,
      default: undefined
    },
    maxLength: {
      type: Number,
      default: undefined
    },
    pattern: {
      type: String,
      default: ''
    },
    required: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'blur', 'focus', 'validate'],
  setup(props, { emit }) {
    const internalValue = ref(props.modelValue)

    watch(() => props.modelValue, (newVal) => {
      internalValue.value = newVal
    })

    const handleChange = (event: Event) => {
      const target = event.target as HTMLInputElement
      internalValue.value = target.value
      
      emit('update:modelValue', target.value)
    }

    const handleFocus = (event: FocusEvent) => {
      emit('focus', event)
    }

    const handleBlur = (event: FocusEvent) => {
      emit('blur', event)
      
      // 验证逻辑
      if (props.required && !internalValue.value) {
        emit('validate', false, '必填项不能为空')
        return
      }
      
      if (props.minLength && String(internalValue.value).length < props.minLength) {
        emit('validate', false, `最少需要${props.minLength}个字符`)
        return
      }
      
      if (props.maxLength && String(internalValue.value).length > props.maxLength) {
        emit('validate', false, `最多${props.maxLength}个字符`)
        return
      }
      
      if (props.pattern && !new RegExp(props.pattern).test(String(internalValue.value))) {
        emit('validate', false, '格式不正确')
        return
      }
      
      emit('validate', true)
    }

    const inputClass = computed(() => {
      return [
        'mp-input',
        `mp-input--${props.size}`,
        { 
          'mp-input--disabled': props.disabled,
          'mp-input--loading': props.loading,
          'mp-input--error': props.error,
          'mp-input--success': props.success
        }
      ]
    })

    return {
      internalValue,
      handleChange,
      handleFocus,
      handleBlur,
      inputClass
    }
  },
  template: `
    <div class="mp-input-wrapper">
      <span v-if="prefix" class="mp-input__prefix">{{ prefix }}</span>
      <input
        :value="internalValue"
        :type="type"
        :placeholder="placeholder"
        :class="inputClass"
        :disabled="disabled || loading"
        :minlength="minLength"
        :maxlength="maxLength"
        :pattern="pattern"
        :required="required"
        @input="handleChange"
        @focus="handleFocus"
        @blur="handleBlur"
      />
      <span v-if="suffix && !loading" class="mp-input__suffix">{{ suffix }}</span>
      <span v-if="loading" class="mp-input__spinner"></span>
    </div>
  `,
  styles: `
    .mp-input-wrapper {
      display: inline-flex;
      align-items: center;
      width: 100%;
      gap: var(--spacing-2);
    }

    .mp-input {
      flex: 1;
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-3) var(--spacing-4);
      font-family: var(--font-family-sans);
      font-size: var(--font-size-base);
      border: 1px solid var(--color-neutral-300);
      border-radius: var(--border-radius-md);
      transition: all 0.15s ease;
      background-color: white;
      color: var(--color-neutral-700);
    }

    .mp-input:focus:not(.mp-input--disabled) {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(79, 105, 255, 0.1);
    }

    .mp-input--small {
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--font-size-sm);
      height: 32px;
    }

    .mp-input--medium {
      padding: var(--spacing-3) var(--spacing-4);
      font-size: var(--font-size-base);
      height: 40px;
    }

    .mp-input--large {
      padding: var(--spacing-4) var(--spacing-5);
      font-size: var(--font-size-lg);
      height: 48px;
    }

    .mp-input--disabled {
      background-color: var(--color-neutral-100);
      cursor: not-allowed;
      opacity: 0.6;
    }

    .mp-input--error {
      border-color: var(--color-error-500);
    }

    .mp-input--error:focus {
      border-color: var(--color-error-600);
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    }

    .mp-input--success {
      border-color: var(--color-success-500);
    }

    .mp-input--success:focus {
      border-color: var(--color-success-600);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }

    .mp-input__prefix,
    .mp-input__suffix {
      color: var(--color-neutral-500);
      font-size: var(--font-size-base);
      white-space: nowrap;
    }

    .mp-input__spinner {
      width: 20px;
      height: 20px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: mp-spin 0.75s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }
  `
})

export default Input
