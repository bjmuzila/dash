{/* Official dxFeed $TOP10 Multi-Feature Explorer - 5 Columns */}
<section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-zinc-800/80 mb-5 gap-4">
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
        dxFeed $TOP10 Multi-Feature Explorer
      </h3>
      <p className="text-zinc-500 text-xs mt-0.5">
        Comparing top market indices across all five calculated stock market indicator features simultaneously
      </p>
    </div>

    <div className="flex flex-wrap gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800/80 max-w-lg">
      {Object.keys(DXFEED_TOP10_MAP).map(key => (
        <button 
          key={key}
          onClick={() => setTop10Index(key)}
          className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${
            top10Index === key 
              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10" 
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {DXFEED_TOP10_MAP[key].name}
        </button>
      ))}
    </div>
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
    {renderTop10Column("abs_gain", "Absolute Gainers", "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", "Abs +")}
    {renderTop10Column("rel_gain", "Relative % Gainers", "text-teal-400 bg-teal-500/10 border-teal-500/20", "% +")}
    {renderTop10Column("abs_lose", "Absolute Losers", "text-rose-400 bg-rose-500/10 border-rose-500/20", "Abs -")}
    {renderTop10Column("rel_lose", "Relative % Losers", "text-red-400 bg-red-500/10 border-red-500/20", "% -")}
    {renderTop10Column("volume", "Active Volume Flow", "text-indigo-400 bg-indigo-500/10 border-indigo-500/20", "Vol")}
  </div>

  <div className="text-[10px] text-zinc-600 mt-4 font-mono flex justify-between items-center border-t border-zinc-800/40 pt-3">
    <span>* Telemetry intervals updated simultaneously based on dxFeed formula streams</span>
    <span className="text-emerald-400 animate-pulse flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Telemetry Stream Engaged
    </span>
  </div>
</section>