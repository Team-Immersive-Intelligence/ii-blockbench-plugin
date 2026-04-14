# Immersive Intelligence Toolkit Plugin for Blockbench


Adds a collection of tools to help with the creation of content for Immersive Intelligence, including:
- Exporter for Static and Dynamic OBJ-AMT model formats (including Collection export)
- Exporter for AMT format animations
- New model parts for emulating
  - AMTFluid
  - AMTBullet
  - AMTItem
  - AMTTracks
  - AMTHans
  - AMTHand

## FAQ

### Use outside of Team II
We'd be happy to see our tools used for other projects. You're free to use the AMT technology and this plugin however you like, a credit is welcome, but not necessary.
Re-distribution of this plugin outside official repositories is forbidden, unless you're granted a special permission, as stated in the License.

### OBJ Exporting
Exported OBJ/OBJ.IE models are standard Wavefront OBJ models, the main difference is in handling of materials - in the default coded, Blockbench exports textures to the same directory as the model.
IIToolkit does not export textures, its material files reference them using Minecraft's Resource Location format.
For example, if your model's material references a texture called `example.png`, it should be located in your resource pack at `assets/yourmodid/textures/example.png` and the material should reference it as `yourmodid:textures/example.png`.

### Internet Connection
For accessing the example models needed for AMTFluid and AMTBullet, a connection is needed. Assets are located on the server at https://assets.iiteam.net/ .
