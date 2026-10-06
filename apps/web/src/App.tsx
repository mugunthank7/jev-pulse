import { Stage } from "./components/Stage";

export default function App() {
  const loop = new URLSearchParams(window.location.search).has("record");
  return <Stage loop={loop} />;
}
