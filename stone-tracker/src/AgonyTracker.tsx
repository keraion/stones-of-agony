import React from "react";
import "./AgonyTracker.css";
import agonyImg from './assets/Stone_of_Agony_OoT.webp';
import gregImg from './assets/OoT_Green_Rupee_Model-2248945142.png';

interface AgonyTrackerProps {
  agony: number | string;
  agonyTotal: number | string;
  greg: number | string;
  gregTotal: number | string;
  showGreg?: boolean;
  showCompletions?: boolean;
  stackedItems?: boolean;
  checks: number | string;
  checksTotal: number | string;
  percent: number | string;
  completions: number | string;
  completionsTotal: number | string;
}

const AgonyTracker: React.FC<AgonyTrackerProps> = ({
  agony,
  agonyTotal,
  greg,
  gregTotal,
  showGreg = false,
  showCompletions = false,
  stackedItems = false,
  checks,
  checksTotal,
  percent,
  completions,
  completionsTotal,
}) => (
  <div className={`tracker-card${showGreg ? ' tracker-card--with-greg' : ''}${showCompletions ? ' tracker-card--with-completions' : ''}${stackedItems ? ' tracker-card--stacked' : ''}`}>
    {stackedItems ? (
      <>
        <div className="tracker-items-stack">
          <div className="tracker-item-row">
            <img
              className="tracker-item-image tracker-item-image--stacked"
              src={agonyImg}
              alt="Agony"
            />
            <div className="tracker-value">{agony}/{agonyTotal}</div>
          </div>
          {showGreg && (
            <div className="tracker-item-row">
              <img
                className="tracker-item-image tracker-item-image--stacked"
                src={gregImg}
                alt="Greg"
              />
              <div className="tracker-value">{greg}/{gregTotal}</div>
            </div>
          )}
        </div>
        <div className="tracker-stack-divider" aria-hidden="true" />
        <div className="tracker-metrics-stack">
          <div className="tracker-section tracker-section--stacked">
            <div className="tracker-label">Checks</div>
            <div className="tracker-value">{checks}/{checksTotal}</div>
          </div>
          <div className="tracker-section tracker-section--stacked">
            <div className="tracker-label">%</div>
            <div className="tracker-value">{percent}</div>
          </div>
          {showCompletions && (
            <div className="tracker-section tracker-section--stacked">
              <div className="tracker-label">Completions</div>
              <div className="tracker-value">{completions}/{completionsTotal}</div>
            </div>
          )}
        </div>
      </>
    ) : (
      <>
        <img
          className="tracker-item-image"
          src={agonyImg}
          alt="Agony"
        />
        <div className="tracker-section">
          <div className="tracker-label">Agony</div>
          <div className="tracker-value">{agony}/{agonyTotal}</div>
        </div>
        {showGreg && (
          <>
            <img
              className="tracker-item-image"
              src={gregImg}
              alt="Greg"
            />
            <div className="tracker-section">
              <div className="tracker-label">Greg</div>
              <div className="tracker-value">{greg}/{gregTotal}</div>
            </div>
          </>
        )}
        <div className="tracker-section">
          <div className="tracker-label">Checks</div>
          <div className="tracker-value">{checks}/{checksTotal}</div>
        </div>
        <div className="tracker-section">
          <div className="tracker-label">%</div>
          <div className="tracker-value">{percent}</div>
        </div>
        {showCompletions && (
          <div className="tracker-section">
            <div className="tracker-label">Completions</div>
            <div className="tracker-value">{completions}/{completionsTotal}</div>
          </div>
        )}
      </>
    )}
  </div>
);

export default AgonyTracker;
