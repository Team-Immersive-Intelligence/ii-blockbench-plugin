const PathModule = require('path');

module.exports = {
	mode: 'development',
	devtool: 'none',
	target: 'node',
	entry: './main.js',
	output: {
		filename: 'iitoolkit.js',
		path: PathModule.resolve(__dirname, '../../plugins')
	}
}
