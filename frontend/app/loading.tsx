export default function Loading() {
  return (
    <section className="route-loading" aria-busy="true" aria-label="Загрузка StayPilot">
      <div className="route-loading-top">
        <div className="route-loading-brand route-loading-shimmer" />
        <div className="route-loading-tools">
          <div className="route-loading-pill route-loading-shimmer" />
          <div className="route-loading-pill route-loading-shimmer" />
          <div className="route-loading-avatar route-loading-shimmer" />
        </div>
      </div>

      <div className="route-loading-grid">
        <aside className="route-loading-left">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="route-loading-nav route-loading-shimmer" />
          ))}
        </aside>

        <div className="route-loading-main">
          <div className="route-loading-hero route-loading-shimmer" />
          <div className="route-loading-tabs">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="route-loading-tab route-loading-shimmer" />
            ))}
          </div>
          <div className="route-loading-cards">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="route-loading-card">
                <div className="route-loading-card-cover route-loading-shimmer" />
                <div className="route-loading-line route-loading-line-strong route-loading-shimmer" />
                <div className="route-loading-line route-loading-shimmer" />
                <div className="route-loading-line route-loading-line-short route-loading-shimmer" />
              </div>
            ))}
          </div>
        </div>

        <aside className="route-loading-chat">
          <div className="route-loading-chat-head route-loading-shimmer" />
          <div className="route-loading-bubble route-loading-shimmer" />
          <div className="route-loading-bubble route-loading-bubble-user route-loading-shimmer" />
          <div className="route-loading-chat-input route-loading-shimmer" />
        </aside>
      </div>
    </section>
  );
}
