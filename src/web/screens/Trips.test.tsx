// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { grossUpCents } from '../../shared/money';
import type { Payment } from '../../shared/types';
import type { PayPalCheckoutProps } from '../components/PayPalCheckout';
import { fakeApi, makeAccount, makeBootstrap, makeSettings, makeStudent } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { Trips } from './Trips';

const paypalRenders: PayPalCheckoutProps[] = [];

vi.mock('../components/PayPalCheckout', () => ({
  PayPalCheckout: (props: PayPalCheckoutProps) => {
    paypalRenders.push(props);
    const payment: Payment = {
      id: 'CAP-1',
      date: '2026-10-21',
      studentId: props.order.studentId,
      activityId: props.order.activityId,
      amountCents: props.order.amountCents,
      feeCents: 0,
      grossCents: props.order.amountCents,
      method: 'PayPal',
      status: 'Completed',
    };
    return (
      <div data-testid="paypal">
        <span data-testid="paypal-order">{JSON.stringify(props.order)}</span>
        <button type="button" onClick={() => props.onPaid(payment)}>
          Simulate PayPal approval
        </button>
        <button type="button" onClick={() => props.onError('Card declined.')}>
          Simulate PayPal error
        </button>
      </div>
    );
  },
}));

function setup(data = makeBootstrap(), handlers = {}) {
  const api = fakeApi(handlers);
  const harness = renderScreen(<Trips />, { api, data });
  return { api, harness, user: userEvent.setup() };
}

function averyCard() {
  return screen.getByRole('article', { name: 'Florida 2027' });
}

describe('Trips', () => {
  it('shows cost, paid, remaining and due dates per activity', () => {
    setup();
    const card = averyCard();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$550.00 of $1,850.00 paid');
    expect(within(card).getByText('$1,300.00')).toBeInTheDocument();
    expect(within(card).getByText(/\$200\.00 from activity funds · \$350\.00 paid/)).toBeInTheDocument();
    expect(within(card).getByText(/Deposit \$350\.00 due/)).toBeInTheDocument();
    expect(within(card).getByText(/Final payment due/)).toBeInTheDocument();
  });

  it('shows an empty state for a student with no activities', () => {
    setup();
    expect(screen.getByText('No trips or activities yet')).toBeInTheDocument();
  });

  describe('Use activity funds', () => {
    it('prefills min(available, remaining − pending), validates, and submits', async () => {
      const { api, harness, user } = setup(makeBootstrap(), {
        'redemption.request': (p: { amountCents: number }) => ({
          redemption: {
            id: 'R-1',
            requestedAt: new Date().toISOString(),
            email: 'parent@example.com',
            familyId: 'F0001',
            studentId: 'S0001',
            activityId: 'FL27',
            amountCents: p.amountCents,
            status: 'Pending',
          },
        }),
      });

      await user.click(within(averyCard()).getByRole('button', { name: 'Use activity funds' }));
      const dialog = screen.getByRole('dialog', { name: 'Use activity funds' });
      const amount = within(dialog).getByLabelText('Amount to apply');
      expect(amount).toHaveValue('640.00');
      expect(amount).toHaveFocus();

      await user.clear(amount);
      await user.type(amount, '700');
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
      expect(within(dialog).getByText("That's more than Avery's available funds ($640.00).")).toBeInTheDocument();

      await user.clear(amount);
      await user.type(amount, '0.50');
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
      expect(within(dialog).getByText('The smallest request is $1.00.')).toBeInTheDocument();

      await user.clear(amount);
      await user.type(amount, 'abc');
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
      expect(within(dialog).getByText('Enter an amount like 125 or 125.50.')).toBeInTheDocument();
      expect(api.call).not.toHaveBeenCalled();

      await user.clear(amount);
      await user.type(amount, '$200');
      await user.type(within(dialog).getByLabelText(/Note for the treasurer/), 'For the deposit');
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }));

      expect(api.call).toHaveBeenCalledWith('redemption.request', {
        studentId: 'S0001',
        activityId: 'FL27',
        amountCents: 20000,
        note: 'For the deposit',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText(/Request sent: \$200\.00 for Florida 2027/)).toBeInTheDocument();
      expect(harness.refresh).toHaveBeenCalledWith({ force: true });
    });

    it("limits requests to what's left after pending requests", async () => {
      const data = makeBootstrap({
        students: [makeStudent({ activities: [makeAccount({ remainingCents: 30000, pendingRedemptionCents: 20000 })] })],
      });
      const { user } = setup(data);
      await user.click(within(averyCard()).getByRole('button', { name: 'Use activity funds' }));
      const dialog = screen.getByRole('dialog');
      const amount = within(dialog).getByLabelText('Amount to apply');
      expect(amount).toHaveValue('100.00');
      await user.clear(amount);
      await user.type(amount, '150');
      await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
      expect(
        within(dialog).getByText("That's more than what's left to cover on this trip ($100.00)."),
      ).toBeInTheDocument();
    });

    it('shows server errors in the dialog and keeps it open', async () => {
      const { ApiError } = await import('../api/client');
      const { user } = setup(makeBootstrap(), {
        'redemption.request': () => {
          throw new ApiError('CONFLICT', 'That trip is closed.');
        },
      });
      await user.click(within(averyCard()).getByRole('button', { name: 'Use activity funds' }));
      await user.click(screen.getByRole('button', { name: 'Send request' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('That trip is closed.');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to the button', async () => {
      const { user } = setup();
      const open = within(averyCard()).getByRole('button', { name: 'Use activity funds' });
      await user.click(open);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(open).toHaveFocus();
    });

    it('lets a parent cancel a pending request', async () => {
      const base = makeBootstrap();
      const data = {
        ...base,
        redemptions: [
          {
            id: 'R-9',
            requestedAt: new Date().toISOString(),
            email: 'parent@example.com',
            familyId: 'F0001',
            studentId: 'S0001',
            activityId: 'FL27',
            amountCents: 20000,
            status: 'Pending' as const,
          },
        ],
      };
      const { api, harness, user } = setup(data, {
        'redemption.cancel': () => ({ redemption: { ...data.redemptions[0], status: 'Cancelled' } }),
      });
      await user.click(within(averyCard()).getByRole('button', { name: 'Cancel request' }));
      const confirm = screen.getByRole('alertdialog', { name: 'Cancel this request?' });
      await user.click(within(confirm).getByRole('button', { name: 'Cancel request' }));
      expect(api.call).toHaveBeenCalledWith('redemption.cancel', { id: 'R-9' });
      await waitFor(() => expect(harness.refresh).toHaveBeenCalledWith({ force: true }));
    });
  });

  describe('Pay online', () => {
    it('computes the optional fee with grossUpCents and passes the order to PayPal', async () => {
      paypalRenders.length = 0;
      const { harness, user } = setup();
      await user.click(within(averyCard()).getByRole('button', { name: 'Pay online' }));
      const dialog = screen.getByRole('dialog', { name: 'Pay online' });
      const amount = within(dialog).getByLabelText('Amount to pay');
      expect(amount).toHaveValue('1300.00');

      const fee = grossUpCents(130000, 1.99, 49).feeCents;
      const feeText = `$${(fee / 100).toFixed(2)}`;
      const box = within(dialog).getByRole('checkbox', {
        name: `Add ${feeText} to cover PayPal's processing fee so 100% goes to Avery's trip`,
      });
      expect(box).toBeChecked();

      const summary = within(dialog).getByLabelText('Payment summary');
      expect(within(summary).getByText('$1,300.00')).toBeInTheDocument();
      expect(within(summary).getByText(feeText)).toBeInTheDocument();
      expect(within(summary).getByText(`$${((130000 + fee) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/, ',')}`)).toBeInTheDocument();
      expect(JSON.parse(within(dialog).getByTestId('paypal-order').textContent!)).toEqual({
        studentId: 'S0001',
        activityId: 'FL27',
        amountCents: 130000,
        coverFee: true,
      });

      await user.click(box);
      expect(within(summary).queryByText('Fee contribution')).not.toBeInTheDocument();
      expect(within(summary).getAllByText('$1,300.00')).toHaveLength(2);
      await waitFor(() =>
        expect(JSON.parse(within(dialog).getByTestId('paypal-order').textContent!).coverFee).toBe(false),
      );

      await user.clear(amount);
      await user.type(amount, '100');
      await waitFor(() =>
        expect(JSON.parse(within(dialog).getByTestId('paypal-order').textContent!).amountCents).toBe(10000),
      );
      // Keystrokes don't each re-create the PayPal buttons.
      expect(paypalRenders.some((p) => p.order.amountCents === 10)).toBe(false);

      await user.click(within(dialog).getByRole('button', { name: 'Simulate PayPal approval' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText(/Payment received – thank you! \$100\.00 toward Florida 2027/)).toBeInTheDocument();
      expect(harness.refresh).toHaveBeenCalledWith({ force: true });
    });

    it('validates the amount against the minimum and what is left', async () => {
      const { user } = setup();
      await user.click(within(averyCard()).getByRole('button', { name: 'Pay online' }));
      const dialog = screen.getByRole('dialog');
      const amount = within(dialog).getByLabelText('Amount to pay');

      await user.clear(amount);
      await user.type(amount, '2');
      expect(within(dialog).getByText('The smallest online payment is $5.00.')).toBeInTheDocument();
      expect(within(dialog).queryByTestId('paypal')).not.toBeInTheDocument();

      await user.clear(amount);
      await user.type(amount, '5000');
      expect(within(dialog).getByText("That's more than what's left to pay ($1,300.00).")).toBeInTheDocument();
      expect(within(dialog).queryByTestId('paypal')).not.toBeInTheDocument();
    });

    it('shows PayPal errors inline', async () => {
      const { user } = setup();
      await user.click(within(averyCard()).getByRole('button', { name: 'Pay online' }));
      await user.click(screen.getByRole('button', { name: 'Simulate PayPal error' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Card declined.');
    });

    it('starts the fee box unchecked when the setting says so', async () => {
      const data = makeBootstrap({ settings: makeSettings({ feeCoverDefault: false }) });
      const { user } = setup(data);
      await user.click(within(averyCard()).getByRole('button', { name: 'Pay online' }));
      expect(screen.getByRole('checkbox', { name: /cover PayPal's processing fee/ })).not.toBeChecked();
      expect(within(screen.getByLabelText('Payment summary')).queryByText('Fee contribution')).not.toBeInTheDocument();
    });

    it('only shows other ways to pay when online payments are off', async () => {
      const data = makeBootstrap({ settings: makeSettings({ onlinePaymentsEnabled: false }) });
      const { user } = setup(data);
      expect(within(averyCard()).queryByRole('button', { name: 'Pay online' })).not.toBeInTheDocument();
      await user.click(within(averyCard()).getByRole('button', { name: 'How to pay' }));
      const dialog = screen.getByRole('dialog', { name: 'How to pay' });
      expect(within(dialog).getByRole('heading', { name: 'Other ways to pay' })).toBeInTheDocument();
      expect(within(dialog).getByText(/P\.O\. Box 420/)).toBeInTheDocument();
      expect(within(dialog).queryByLabelText('Amount to pay')).not.toBeInTheDocument();
      expect(within(dialog).queryByTestId('paypal')).not.toBeInTheDocument();
    });

    it('hides online payment for activities that do not allow it', async () => {
      const data = makeBootstrap({
        students: [makeStudent({ activities: [makeAccount({ allowOnlinePayment: false })] })],
      });
      const { user } = setup(data);
      await user.click(within(averyCard()).getByRole('button', { name: 'How to pay' }));
      expect(screen.queryByTestId('paypal')).not.toBeInTheDocument();
      expect(screen.getByText(/Checks payable/)).toBeInTheDocument();
    });
  });
});
