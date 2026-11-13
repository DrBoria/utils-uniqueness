import React from "react";
import { Shell } from "./components/Shell";
import { screenOf } from "./navigation";
import { useRoute } from "./utils/router";

const App = ({ data }) => {
	const { tab, params } = useRoute();
	const Screen = screenOf(tab);

	return (
		<Shell data={data} tab={tab}>
			<Screen data={data} params={params} />
		</Shell>
	);
};

export default App;
