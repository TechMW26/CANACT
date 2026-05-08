export default function AppRouteLoading() {
  return (
    <div className="min-h-[calc(var(--canact-viewport-height)-9rem)] animate-pulse px-1 pb-6 pt-3">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#FFE4E8]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-28 rounded-full bg-[#FFE4E8]" />
          <div className="h-2.5 w-40 rounded-full bg-[#FFF0F2]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 h-48 rounded-[24px] border border-[#F1D7DC] bg-[#FFF4F6]" />
        <div className="h-36 rounded-[22px] border border-[#F1D7DC] bg-[#FFF4F6]" />
        <div className="h-36 rounded-[22px] border border-[#F1D7DC] bg-[#FFF4F6]" />
        <div className="col-span-2 h-24 rounded-[22px] border border-[#F1D7DC] bg-white" />
      </div>
    </div>
  );
}
