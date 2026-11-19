import { EXPLORER } from '../lib/chain';
import { date, shortAddr, usd } from '../lib/format';
import type { RoundTrip } from '../lib/roundTrip';
import { PRICE_SOURCE } from '../lib/trade';

export function RoundTripReview({ pair, buyHash, sellHash }: { pair: RoundTrip; buyHash: string; sellHash: string }) {
  return (
    <>
      <h3>Buy and sell</h3>
      <table className="table">
        <thead><tr><th>Trade</th><th>Agent sent</th><th>Agent received</th><th>Time</th><th>Transaction / destination</th></tr></thead>
        <tbody>
          <tr>
            <td>Buy</td>
            <td>{pair.spent.amount} {pair.spent.symbol}</td>
            <td>{pair.acquired.amount} {pair.acquired.symbol}</td>
            <td>{date(pair.buy.timestamp)}</td>
            <td className="small">
              <a className="mono" href={`${EXPLORER}/tx/${buyHash}`} target="_blank" rel="noreferrer" aria-label="View buy transaction">{shortAddr(buyHash)}</a>
              {' · '}{pair.buy.to ? <a href={`${EXPLORER}/address/${pair.buy.to}`} target="_blank" rel="noreferrer">To {shortAddr(pair.buy.to)}</a> : 'Contract creation'}
            </td>
          </tr>
          <tr>
            <td>Sell</td>
            <td>{pair.sold.amount} {pair.sold.symbol}</td>
            <td>{pair.received.amount} {pair.received.symbol}</td>
            <td>{date(pair.sell.timestamp)}</td>
            <td className="small">
              <a className="mono" href={`${EXPLORER}/tx/${sellHash}`} target="_blank" rel="noreferrer" aria-label="View sell transaction">{shortAddr(sellHash)}</a>
              {' · '}{pair.sell.to ? <a href={`${EXPLORER}/address/${pair.sell.to}`} target="_blank" rel="noreferrer">To {shortAddr(pair.sell.to)}</a> : 'Contract creation'}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Token contracts: {pair.spent.symbol} <a className="mono" href={`${EXPLORER}/token/${pair.spent.token}`} target="_blank" rel="noreferrer">{shortAddr(pair.spent.token)}</a> · {pair.acquired.symbol} <a className="mono" href={`${EXPLORER}/token/${pair.acquired.token}`} target="_blank" rel="noreferrer">{shortAddr(pair.acquired.token)}</a></p>
      <dl className="kv">
        <dt>Spent on buy</dt><dd>{usd(pair.buyValue)}</dd>
        <dt>Received on sell</dt><dd>{usd(pair.sellValue)}</dd>
        <dt>Realized loss</dt><dd>{usd(pair.loss)}</dd>
      </dl>
      <p className="muted small">Values use {PRICE_SOURCE} historical price estimates near each trade time, not exact execution-block quotes. On Base Sepolia, known test tokens use their Base mainnet counterpart prices. Token transfers alone do not prove who controls a counterparty or whether the strategy was broken.</p>
    </>
  );
}
