// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog, Dialog } from './Dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div id="root">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        title="Example"
        onClose={() => setOpen(false)}
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <label>
          Name <input />
        </label>
      </Dialog>
    </div>
  );
}

describe('Dialog', () => {
  it('is labelled, moves focus in, traps Tab, and restores focus on Escape', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Example' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByLabelText('Name');
    expect(input).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes from the close button and the backdrop', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(document.querySelector('.dialog-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("reads a confirmation's message along with its title (role=alertdialog)", () => {
    render(
      <div id="root">
        <ConfirmDialog
          open
          title="Cancel this request?"
          message="Your request to apply $200.00 to Spring Trip will be withdrawn."
          confirmLabel="Cancel request"
          cancelLabel="Keep it"
          danger
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />
      </div>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel this request?' });
    expect(dialog).toHaveAccessibleDescription('Your request to apply $200.00 to Spring Trip will be withdrawn.');
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
  });
});
