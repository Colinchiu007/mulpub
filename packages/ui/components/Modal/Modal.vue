import { defineComponent, ref, onMounted, onUnmounted } from 'vue'

interface ModalProps {
  modelValue?: boolean
  title?: string
  confirmText?: string
  cancelText?: string
  confirmType?: 'primary' | 'danger' | 'text'
  showCancel?: boolean
  draggable?: boolean
  closeOnBackdrop?: boolean
}

export const Modal = defineComponent({
  name: 'MpModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: '提示'
    },
    confirmText: {
      type: String,
      default: '确定'
    },
    cancelText: {
      type: String,
      default: '取消'
    },
    confirmType: {
      type: String as () => 'primary' | 'danger' | 'text',
      default: 'primary'
    },
    showCancel: {
      type: Boolean,
      default: true
    },
    draggable: {
      type: Boolean,
      default: false
    },
    closeOnBackdrop: {
      type: Boolean,
      default: true
    }
  },
  emits: ['update:modelValue', 'confirm', 'cancel', 'open', 'close'],
  setup(props, { emit }) {
    const modalVisible = ref(props.modelValue)
    const isDragging = ref(false)
    const dragOffset = { x: 0, y: 0 }

    onMounted(() => {
      if (modalVisible.value) {
        document.body.style.overflow = 'hidden'
      }
    })

    onUnmounted(() => {
      document.body.style.overflow = ''
    })

    const open = () => {
      modalVisible.value = true
      emit('open')
    }

    const close = () => {
      modalVisible.value = false
      emit('close')
      emit('update:modelValue', false)
    }

    const handleConfirm = () => {
      emit('confirm')
      close()
    }

    const handleCancel = () => {
      emit('cancel')
      close()
    }

    const handleBackdropClick = (event: MouseEvent) => {
      if (props.closeOnBackdrop && event.target === event.currentTarget) {
        close()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && modalVisible.value) {
        close()
      }
    }

    const startDrag = (event: MouseEvent) => {
      if (!props.draggable) return
      
      isDragging.value = true
      const modalEl = event.currentTarget as HTMLElement
      const rect = modalEl.getBoundingClientRect()
      dragOffset.x = event.clientX - rect.left
      dragOffset.y = event.clientY - rect.top
      
      document.addEventListener('mousemove', onDrag)
      document.addEventListener('mouseup', endDrag)
    }

    const onDrag = (event: MouseEvent) => {
      if (!isDragging.value) return
      
      const modalEl = event.currentTarget as HTMLElement
      modalEl.style.position = 'fixed'
      modalEl.style.left = `${event.clientX - dragOffset.x}px`
      modalEl.style.top = `${event.clientY - dragOffset.y}px`
    }

    const endDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', onDrag)
      document.removeEventListener('mouseup', endDrag)
    }

    // 监听 modelValue 变化
    const watchHandler = (newVal: boolean) => {
      modalVisible.value = newVal
      if (newVal) {
        document.body.style.overflow = 'hidden'
        emit('open')
      } else {
        document.body.style.overflow = ''
        emit('close')
      }
    }

    // eslint-disable-next-line vue/no-mutating-props
    watchHandler(props.modelValue)

    return {
      modalVisible,
      open,
      close,
      handleConfirm,
      handleCancel,
      handleBackdropClick,
      handleKeyDown,
      startDrag,
      isDragging
    }
  },
  template: `
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="modalVisible" class="mp-modal-overlay" @click="handleBackdropClick">
          <div 
            class="mp-modal" 
            :class="{ 'mp-modal--draggable': draggable }"
            @keydown="handleKeyDown"
            tabindex="0"
          >
            <div 
              v-if="draggable" 
              class="mp-modal-header" 
              @mousedown="startDrag"
            >
              <h2 class="mp-modal-title">{{ title }}</h2>
              <button class="mp-modal-close" @click="close">×</button>
            </div>
            
            <div v-else class="mp-modal-header">
              <h2 class="mp-modal-title">{{ title }}</h2>
              <button class="mp-modal-close" @click="close">×</button>
            </div>
            
            <div class="mp-modal-content">
              <slot></slot>
            </div>
            
            <div class="mp-modal-footer">
              <button 
                v-if="showCancel" 
                class="mp-button mp-button--secondary mp-button--small"
                @click="handleCancel"
              >
                {{ cancelText }}
              </button>
              <button 
                class="mp-button mp-button--{{ confirmType }} mp-button--small"
                @click="handleConfirm"
              >
                {{ confirmText }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  `,
  styles: `
    .mp-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .mp-modal {
      background-color: white;
      border-radius: var(--border-radius-lg);
      box-shadow: var(--shadow-xl);
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .mp-modal--draggable {
      cursor: move;
    }

    .mp-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4) var(--spacing-6);
      border-bottom: 1px solid var(--color-neutral-200);
    }

    .mp-modal-title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin: 0;
    }

    .mp-modal-close {
      background: none;
      border: none;
      font-size: var(--font-size-3xl);
      color: var(--color-neutral-500);
      cursor: pointer;
      padding: var(--spacing-1);
      line-height: 1;
    }

    .mp-modal-close:hover {
      color: var(--color-neutral-700);
    }

    .mp-modal-content {
      padding: var(--spacing-6);
      overflow-y: auto;
      flex: 1;
      color: var(--color-neutral-700);
    }

    .mp-modal-footer {
      padding: var(--spacing-4) var(--spacing-6);
      border-top: 1px solid var(--color-neutral-200);
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

    /* Animations */
    .modal-enter-active,
    .modal-leave-active {
      transition: all 0.2s ease;
    }

    .modal-enter-from,
    .modal-leave-to {
      opacity: 0;
      transform: scale(0.95);
    }
  `
})

export default Modal
