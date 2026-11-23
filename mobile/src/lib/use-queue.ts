import { useEffect, useState } from "react";
import { clearFailures, failures, pending, subscribe } from "./queue";
import type { Queued } from "./queue-core";

/** Oflayn navbat holati: navbatdagi amallar soni va server rad etganlari. */
export function useQueueInfo() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Queued[]>([]);
  const [failed, setFailed] = useState(failures());
  useEffect(() => {
    const update = () => {
      void pending().then((q) => {
        setCount(q.length);
        setItems(q);
      });
      setFailed([...failures()]);
    };
    update();
    return subscribe(update);
  }, []);
  return { count, items, failed, dismiss: clearFailures };
}
