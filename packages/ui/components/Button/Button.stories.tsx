import type { Meta, ComponentStoryFn } from '@storybook/vue3'
import Button from './Button.vue'

export default {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'radio',
      options: ['primary', 'secondary', 'danger', 'text'],
    },
    size: {
      control: 'radio',
      options: ['small', 'medium', 'large'],
    },
    loading: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
    block: {
      control: 'boolean',
    },
  },
  parameters: {
    docs: {
      description: {
        component: '按钮组件，支持多种变体和尺寸，提供 Loading 状态和图标支持。',
      },
    },
  },
} as Meta

const Template: ComponentStoryFn<typeof Button> = (args) => ({
  components: { Button },
  setup() {
    return { args }
  },
  template: '<MpButton v-bind="args">按钮文本</MpButton>',
})

export const Primary = Template.bind({})
Primary.args = {
  variant: 'primary',
  size: 'medium',
}

export const Secondary = Template.bind({})
Secondary.args = {
  variant: 'secondary',
  size: 'medium',
}

export const Danger = Template.bind({})
Danger.args = {
  variant: 'danger',
  size: 'medium',
}

export const Text = Template.bind({})
Text.args = {
  variant: 'text',
  size: 'medium',
}

export const Small = Template.bind({})
Small.args = {
  variant: 'primary',
  size: 'small',
}

export const Large = Template.bind({})
Large.args = {
  variant: 'primary',
  size: 'large',
}

export const Loading = Template.bind({})
Loading.args = {
  variant: 'primary',
  size: 'medium',
  loading: true,
}

export const Disabled = Template.bind({})
Disabled.args = {
  variant: 'primary',
  size: 'medium',
  disabled: true,
}

export const WithIcon = Template.bind({})
WithIcon.args = {
  variant: 'primary',
  size: 'medium',
  icon: '📁',
}

export const Block = Template.bind({})
Block.args = {
  variant: 'primary',
  size: 'medium',
  block: true,
}
