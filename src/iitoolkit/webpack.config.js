const PathModule = require('path');

module.exports = {
	mode: 'development',
	target: 'node',
	entry: './main.js',
	output: {
		filename: 'iitoolkit.js',
		path: PathModule.resolve(__dirname, '../../plugins/iitoolkit'),
		publicPath: 'plugins/iitoolkit'    // Ensure assets are requested from /plugins/assets/
	},
	module: {
		rules: [
			{
				test: /\.(gltf|glb|bin|png|jpe?g|svg)$/,
				type: 'asset/resource',
				generator: {
					filename: 'assets/[name][ext][query]'
				}
			}
		]
	}
};