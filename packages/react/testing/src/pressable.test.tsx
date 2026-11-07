import { Text, usePressable, View } from '@soundor/react';
import { getTestRuntime, type TestNode } from '@soundor/test-runtime';
import {
  render,
  screen,
  userEvent,
  advanceTime,
} from '@soundor/testing-library/react';
import { createRef, useState, type ReactNode } from 'react';
import { root, type UiNode } from 'soundor:ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function show(element: ReactNode) {
  if (mounted) await mounted.rerender(element);
  else mounted = await render(element, { container: root });
}

afterEach(() => {
  mounted = null;
});

interface ButtonProps {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  nodeRef?: React.Ref<UiNode>;
}

/** A component of one's own, made with the hook. */
function Button({
  label,
  onPress,
  onLongPress,
  disabled,
  nodeRef,
}: ButtonProps) {
  const press = usePressable({ onPress, onLongPress, disabled, ref: nodeRef });
  return (
    <View
      {...press.pressableProps}
      style={{ opacity: press.pressed ? 0.5 : press.hovered ? 0.8 : 1 }}
    >
      <Text>{press.focusVisible ? `[${label}]` : label}</Text>
    </View>
  );
}

describe('usePressable', () => {
  it('presses, and gives its state to render with', async () => {
    const onPress = vi.fn();
    await show(<Button label="Reset" onPress={onPress} />);

    const user = userEvent.setup(),
      button = screen.getByRole('button', { name: 'Reset' });
    expect(button.focusable).toBe(true);
    await user.pointer({ target: button });
    expect(button.style.opacity).toBe(0.8);
    await user.pointer({ target: button, keys: '[MouseLeft>]' });
    expect(button.style.opacity).toBe(0.5);
    await user.pointer({ target: button, keys: '[/MouseLeft]' });

    expect(onPress).toHaveBeenCalledOnce();
    expect(button.style.opacity).toBe(0.8);
  });

  it('shows focus from the keyboard, and presses with it', async () => {
    const onPress = vi.fn();
    await show(<Button label="Reset" onPress={onPress} />);

    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByText('[Reset]')).toBeDefined();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('calls the latest callbacks, and long presses', async () => {
    const first = vi.fn(),
      latest = vi.fn();
    await show(<Button label="Hold" onLongPress={first} />);
    await show(<Button label="Hold" onLongPress={latest} />);

    const user = userEvent.setup(),
      button = screen.getByRole('button');
    expect(button.accessibility.actions?.map((action) => action.name)).toEqual([
      'activate',
      'longpress',
    ]);
    await user.pointer({ target: button, keys: '[MouseLeft>]' });
    await advanceTime(500);
    await user.pointer({ target: button, keys: '[/MouseLeft]' });

    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('gives the node to a ref of its own', async () => {
    const ref = createRef<UiNode>();
    await show(<Button label="Reset" nodeRef={ref} />);
    expect(ref.current).toBe(screen.getByRole('button'));
  });

  it('disabled: not pressable nor focusable, and told so', async () => {
    const onPress = vi.fn();
    function Toggle() {
      const [disabled, setDisabled] = useState(false);
      return (
        <>
          <Button label="Reset" onPress={onPress} disabled={disabled} />
          <Button label="Lock" onPress={() => setDisabled(true)} />
        </>
      );
    }
    await show(<Toggle />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lock' }));

    const button = screen.getByRole('button', { name: 'Reset' }) as TestNode;
    expect(getTestRuntime().pressables.has(button)).toBe(false);
    expect(button.focusable).toBe(false);
    expect(button.accessibility.state?.disabled).toBe(true);
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
