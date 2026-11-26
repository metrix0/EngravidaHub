// app/dev/map/page.tsx
import TrackingMap from "./TrackingMap";

export default function DevTrackingMapPage() {
    return (
        <main className="fixed inset-0 z-50 overflow-hidden bg-background text-slate-900">
            <TrackingMap />
        </main>
    );
}
