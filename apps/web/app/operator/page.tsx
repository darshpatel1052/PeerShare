import type { Metadata } from "next";
import Operator from "../../components/operator";
export const metadata: Metadata = { title: "Platform operations" };
export default function Page() {
  return <Operator />;
}
